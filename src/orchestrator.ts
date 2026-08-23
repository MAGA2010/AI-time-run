/**
 * orchestrator.ts
 *
 * The harness orchestration center. It wires the brain (Reasoner), the hands
 * (Sandbox), the constitution (Critic), authority, verification, and memory
 * into one Planner-Generator-Evaluator-Critic loop over a Session ledger.
 */

import { join } from 'node:path';

import { ROLES } from './actors.js';
import { AuthorityEngine } from './authority.js';
import { CausalGraph, classifyEffect } from './causal.js';
import { ConjectureScheduler, Simulator } from './cognition.js';
import { Constitution } from './constitution.js';
import { attributeFailure, auditEntropy, buildEpisode, recordIntervention } from './episode.js';
import { recordClaim } from './evidence.js';
import { Ledger } from './ledger.js';
import {
  ArtifactStore,
  BeliefRouter,
  EpisodicMemory,
  FailureMemory,
  ProgressJournal,
} from './memory.js';
import { Oversight } from './oversight.js';
import { project } from './project.js';
import { Sandbox } from './sandbox.js';
import { summarize } from './session.js';
import { runProbe } from './verification.js';
import { validateLedger } from './invariants.js';
import { TrustGateway } from './trust.js';
import type {
  CapabilityGrant,
  Feature,
  FeatureSpec,
  Mission,
  Plan,
  Principle,
  Probe,
  Reasoner,
  RunResult,
  Tool,
} from './types.js';

export interface FeatureBinding {
  featureId: string;
  toolName: string;
  probeId: string;
  scope: string;
}

export interface ManagedOptions {
  mission: Mission;
  features: FeatureSpec[];
  grants: CapabilityGrant[];
  principles: Principle[];
  reasoner: Reasoner;
  bindings: FeatureBinding[];
  tools: Tool[];
  probes: Probe[];
  highImpactScopes: Set<string>;
  approve?: (scope: string, detail: string) => Promise<boolean> | boolean;
  maxRevisions?: number;
  storeDir?: string;
}

export class ManagedRuntime {
  readonly ledger = new Ledger();
  readonly authority: AuthorityEngine;
  readonly constitution: Constitution;
  readonly sandbox = new Sandbox();
  readonly progress: ProgressJournal;
  readonly artifacts: ArtifactStore;
  readonly episodic = new EpisodicMemory();
  readonly failures = new FailureMemory();
  readonly beliefs: BeliefRouter;
  readonly oversight: Oversight;
  readonly trust = new TrustGateway();
  readonly simulator: Simulator;
  readonly conjectures: ConjectureScheduler;

  private reasoner: Reasoner;
  private probes = new Map<string, Probe>();
  private bindings = new Map<string, FeatureBinding>();
  private highImpactScopes: Set<string>;
  private approve: (scope: string, detail: string) => Promise<boolean> | boolean;
  private maxRevisions: number;
  private storeDir: string | undefined;

  private constructor(options: ManagedOptions) {
    this.reasoner = options.reasoner;
    this.approve = options.approve ?? (() => true);
    this.maxRevisions = options.maxRevisions ?? 3;
    this.storeDir = options.storeDir;
    this.progress = new ProgressJournal(options.storeDir);
    this.artifacts = new ArtifactStore(options.storeDir);
    this.beliefs = new BeliefRouter(this.ledger);
    this.oversight = new Oversight(this.ledger);
    this.simulator = new Simulator(this.sandbox);
    this.conjectures = new ConjectureScheduler(this.ledger);
    this.highImpactScopes = options.highImpactScopes;

    const gates = [...options.highImpactScopes].map((scope) => ({ scope, id: `gate:${scope}` }));
    this.authority = new AuthorityEngine(gates);
    this.constitution = new Constitution(options.principles);

    for (const tool of options.tools) this.sandbox.register(tool);
    for (const probe of options.probes) this.probes.set(probe.id, probe);
    for (const binding of options.bindings) this.bindings.set(binding.featureId, binding);
  }

  static create(options: ManagedOptions): ManagedRuntime {
    const runtime = new ManagedRuntime(options);

    runtime.ledger.append({
      type: 'mission.created',
      actor: ROLES.principal,
      payload: { mission: options.mission },
    });

    for (const feature of options.features) {
      runtime.ledger.append({
        type: 'feature.registered',
        actor: ROLES.initializer,
        payload: {
          featureId: feature.id,
          description: feature.description,
          steps: feature.steps,
        },
      });
    }

    for (const grant of options.grants) {
      runtime.authority.issueGrant(
        runtime.ledger,
        grant.issuedBy,
        grant.actor,
        grant.scope,
        grant.level,
      );
    }

    runtime.progress.append(
      `initialized mission "${options.mission.id}" with ${options.features.length} feature(s)`,
    );
    return runtime;
  }

  mission(): Mission {
    return project(this.ledger).mission as Mission;
  }

  isShutdown(): boolean {
    return project(this.ledger).shutdown;
  }

  async selectNext(): Promise<string | null> {
    const state = project(this.ledger);
    const pending = [...state.features.values()].filter((feature) => !feature.passes);
    if (pending.length === 0) return null;

    const context = summarize(this.ledger);
    const plan = await this.plan(this.mission(), pending, context);
    return plan.featureId;
  }

  async runNext(): Promise<RunResult> {
    const featureId = await this.selectNext();
    if (!featureId) return { ok: false, reason: 'no-pending-features' };
    return this.runFeature(featureId);
  }

  async runAll(): Promise<RunResult[]> {
    const results: RunResult[] = [];
    const featureIds = [...project(this.ledger).features.keys()];
    for (const featureId of featureIds) {
      if (this.isShutdown()) break;
      results.push(await this.runFeature(featureId));
    }
    return results;
  }

  async runFeature(featureId: string): Promise<RunResult> {
    if (this.isShutdown()) return { ok: false, reason: 'shutdown', featureId };

    const state = project(this.ledger);
    const feature = state.features.get(featureId);
    if (!feature) return { ok: false, reason: `unknown-feature:${featureId}`, featureId };
    if (feature.passes) return { ok: false, reason: `already-passing:${featureId}`, featureId };

    const binding = this.bindings.get(featureId);
    if (!binding) return { ok: false, reason: `no-binding:${featureId}`, featureId };

    const context = summarize(this.ledger);

    const plan = await this.plan(this.mission(), [feature], context);
    const planEvent = this.ledger.append({
      type: 'plan.recorded',
      actor: ROLES.planner,
      payload: { featureId: plan.featureId, claim: plan.claim, steps: plan.steps },
    });
    const claimEvent = recordClaim(this.ledger, ROLES.planner, plan.claim, planEvent.id);

    const candidate = await this.generateUntilConstitutional(plan, context);
    if (!candidate.ok) {
      attributeFailure(
        this.ledger,
        ROLES.critic,
        featureId,
        'model',
        'candidate failed constitutional critique',
      );
      return { ok: false, reason: 'constitution-rejected', featureId };
    }

    const decision = this.authority.canAct(
      this.ledger,
      ROLES.generator,
      binding.scope,
      'act',
    );
    if (!decision.ok) {
      if (decision.approvalRequired) {
        const approved = await this.approve(binding.scope, candidate.eventId);
        recordIntervention(
          this.ledger,
          ROLES.principal,
          'approval',
          binding.scope,
          approved ? 'approved' : 'denied',
          false,
        );
        if (!approved) {
          this.ledger.append({
            type: 'approval.denied',
            actor: ROLES.principal,
            payload: { scope: binding.scope, candidateId: candidate.eventId },
          });
          return { ok: false, reason: `approval-denied:${binding.scope}`, featureId };
        }
        this.ledger.append({
          type: 'approval.granted',
          actor: ROLES.principal,
          payload: { scope: binding.scope, candidateId: candidate.eventId },
        });
      } else {
        return { ok: false, reason: decision.reason ?? 'not-authorized', featureId };
      }
    }

    const tool = this.sandbox.tool(binding.toolName);
    const requested = this.ledger.append({
      type: 'effect.requested',
      actor: ROLES.generator,
      payload: {
        scope: binding.scope,
        featureId,
        requested: tool?.description ?? binding.toolName,
      },
      parent: candidate.eventId,
    });
    this.ledger.append({
      type: 'checkpoint.created',
      actor: ROLES.generator,
      payload: { before: this.sandbox.snapshot(), featureId },
      parent: requested.id,
    });

    const result = await this.sandbox.execute(binding.toolName, { featureId });
    this.ledger.append({
      type: 'effect.actualized',
      actor: ROLES.generator,
      payload: { scope: binding.scope, actual: result.ok ? result.output : result.error },
      parent: requested.id,
    });

    if (!result.ok) {
      attributeFailure(
        this.ledger,
        ROLES.evaluator,
        featureId,
        'tool',
        result.error ?? 'tool-failed',
      );
      await this.rollback(requested.id, featureId);
      this.failures.record(featureId, result.error ?? 'tool-failed');
      return { ok: false, reason: `tool-failed:${result.error}`, featureId };
    }

    const probe = this.probes.get(binding.probeId);
    if (!probe) {
      attributeFailure(
        this.ledger,
        ROLES.evaluator,
        featureId,
        'feedback',
        `missing-probe:${binding.probeId}`,
      );
      await this.rollback(requested.id, featureId);
      this.failures.record(featureId, `missing-probe:${binding.probeId}`);
      return { ok: false, reason: `missing-probe:${binding.probeId}`, featureId };
    }

    const evidenceEvent = await runProbe(this.ledger, ROLES.evaluator, probe, claimEvent.id);
    const evidence = project(this.ledger).evidence.get(evidenceEvent.id);
    const assessment = evidence
      ? this.trust.assess(evidence)
      : { ok: false, trust: 'untrusted' as const, reason: 'no evidence' };
    this.ledger.append({
      type: 'trust.assessed',
      actor: ROLES.evaluator,
      payload: {
        evidenceId: evidenceEvent.id,
        ok: assessment.ok,
        trust: assessment.trust,
        reason: assessment.reason,
      },
      parent: evidenceEvent.id,
    });
    const evaluation = await this.reasoner.evaluate(
      candidate.candidate,
      evidence ? [evidence] : [],
      context,
    );
    this.ledger.append({
      type: 'evaluation.recorded',
      actor: ROLES.evaluator,
      payload: { candidateId: candidate.eventId, ok: evaluation.ok, summary: evaluation.summary },
      parent: evidenceEvent.id,
    });

    if (assessment.ok && evaluation.ok) {
      this.ledger.append({
        type: 'effect.verified',
        actor: ROLES.evaluator,
        payload: { scope: binding.scope, featureId },
        parent: requested.id,
        evidence: evidenceEvent.id,
      });
      this.ledger.append({
        type: 'feature.updated',
        actor: ROLES.evaluator,
        payload: { featureId, passes: true, evidenceEventId: evidenceEvent.id },
        parent: requested.id,
      });
      this.beliefs.assert(ROLES.evaluator, featureId, { passes: true, evidenceId: evidenceEvent.id });
      this.episodic.remember(`verified ${featureId}`, context);
      this.progress.append(`feature ${featureId} verified via ${probe.id}`);
      return { ok: true, featureId, eventId: evidenceEvent.id };
    }

    attributeFailure(
      this.ledger,
      ROLES.evaluator,
      featureId,
      'verify',
      'probe evidence or evaluation failed',
    );
    await this.rollback(requested.id, featureId);
    this.failures.record(featureId, 'verification-failed');
    return { ok: false, reason: 'verification-failed-and-rolled-back', featureId };
  }

  validate() {
    return validateLedger(this.ledger);
  }

  episode() {
    return buildEpisode(this.ledger);
  }

  auditEntropy() {
    return auditEntropy(this.ledger, ROLES.observer);
  }

  shutdown(reason = 'operator requested shutdown') {
    const event = this.ledger.append({
      type: 'shutdown.requested',
      actor: ROLES.principal,
      payload: { reason },
    });
    this.progress.append(`shutdown: ${reason}`);
    return event;
  }

  save(): string | null {
    if (!this.storeDir) return null;
    auditEntropy(this.ledger, ROLES.observer);
    return this.ledger.save(join(this.storeDir, 'ledger.jsonl'));
  }

  causalGraph(): CausalGraph {
    return new CausalGraph(this.ledger);
  }

  async simulate(toolName: string, input: Record<string, unknown>) {
    const outcome = await this.simulator.simulate(toolName, input);
    this.ledger.append({
      type: 'simulation.recorded',
      actor: ROLES.planner,
      payload: {
        toolName,
        input,
        predicted: outcome.predicted,
        confidence: outcome.confidence,
      },
    });
    return outcome;
  }

  conjecture(subject: string, hypothesis: unknown) {
    return this.conjectures.schedule(ROLES.planner, subject, hypothesis);
  }

  effectInsulation(effectRequestId: string): 'atomic' | 'parallel' {
    const event = this.ledger.get(effectRequestId);
    if (!event) return 'parallel';
    return classifyEffect(event, this.highImpactScopes);
  }

  private async plan(mission: Mission, features: Feature[], context: string): Promise<Plan> {
    return this.reasoner.plan(mission, features, context);
  }

  private async generateUntilConstitutional(
    plan: Plan,
    context: string,
  ): Promise<{ ok: boolean; eventId: string; candidate: { id: string; planId: string; content: string } }> {
    let candidate = await this.reasoner.generate(plan, context);
    let candidateEvent = this.ledger.append({
      type: 'candidate.proposed',
      actor: ROLES.generator,
      payload: { planId: plan.id, content: candidate.content },
    });

    let review = await this.constitution.review(this.reasoner, candidate, context);
    let revisions = 0;

    while (!review.ok && revisions < this.maxRevisions) {
      this.ledger.append({
        type: 'critique.recorded',
        actor: ROLES.critic,
        payload: { candidateId: candidateEvent.id, critiques: review.critiques, ok: false },
        parent: candidateEvent.id,
      });
      this.ledger.append({
        type: 'revision.requested',
        actor: ROLES.critic,
        payload: { candidateId: candidateEvent.id, planId: plan.id },
        parent: candidateEvent.id,
      });

      revisions += 1;
      candidate = await this.reasoner.generate(
        plan,
        `${context}\ncritique: ${JSON.stringify(review.critiques)}`,
      );
      candidateEvent = this.ledger.append({
        type: 'candidate.proposed',
        actor: ROLES.generator,
        payload: { planId: plan.id, content: candidate.content },
        parent: plan.id,
      });
      review = await this.constitution.review(this.reasoner, candidate, context);
    }

    this.ledger.append({
      type: 'critique.recorded',
      actor: ROLES.critic,
      payload: { candidateId: candidateEvent.id, critiques: review.critiques, ok: review.ok },
      parent: candidateEvent.id,
    });

    return { ok: review.ok, eventId: candidateEvent.id, candidate };
  }

  private async rollback(requestedId: string, featureId: string): Promise<void> {
    const snapshot = project(this.ledger).checkpoints
      .filter((event) => event.parent === requestedId)
      .at(-1)?.payload.before;

    this.ledger.append({
      type: 'rollback.requested',
      actor: ROLES.evaluator,
      payload: { featureId, requestedId },
      parent: requestedId,
    });

    if (snapshot && typeof snapshot === 'object') {
      this.sandbox.restore(snapshot as Record<string, unknown>);
    }

    this.ledger.append({
      type: 'effect.reverted',
      actor: ROLES.evaluator,
      payload: { featureId },
      parent: requestedId,
    });
  }
}
