/**
 * runtime.ts
 *
 * The SEAC runtime. One append-only ledger drives the full loop:
 * claim -> authorize -> effect -> verify -> commit, with rollback,
 * shutdown, and an action ledger for oversight.
 */

import { join } from 'node:path';

import { AuthorityEngine } from './authority.js';
import { recordClaim } from './evidence.js';
import { Ledger } from './ledger.js';
import { ArtifactStore, ProgressJournal } from './memory.js';
import { project } from './project.js';
import { runProbe } from './verification.js';
import type {
  CapabilityGrant,
  EffectHandler,
  Feature,
  Mission,
  Probe,
  RunResult,
  RuntimeOptions,
} from './types.js';
import { validateLedger } from './invariants.js';

const PRINCIPAL = 'principal';
const INITIALIZER = 'initializer';
const CODING = 'coding-agent';
const VERIFIER = 'verifier';

export interface RuntimeMetrics {
  totalFeatures: number;
  passingFeatures: number;
  claims: number;
  evidence: number;
  effects: number;
  verifiedEffects: number;
  revertedEffects: number;
  shutdown: boolean;
}

export class Runtime {
  readonly ledger = new Ledger();
  readonly authority: AuthorityEngine;
  readonly progress: ProgressJournal;
  readonly artifacts: ArtifactStore;

  private probes = new Map<string, Probe>();
  private handlers: EffectHandler[];
  private approve: (scope: string, detail: string) => Promise<boolean> | boolean;
  private storeDir: string | undefined;

  private constructor(options: RuntimeOptions, handlers: EffectHandler[]) {
    this.handlers = handlers;
    this.approve = options.approve ?? (() => true);
    this.storeDir = options.storeDir;
    this.progress = new ProgressJournal(options.storeDir);
    this.artifacts = new ArtifactStore(options.storeDir);

    const gates = [...options.highImpactScopes].map((scope) => ({ scope, id: `gate:${scope}` }));
    this.authority = new AuthorityEngine(gates);

    for (const probe of options.probes) this.probes.set(probe.id, probe);
  }

  static create(options: RuntimeOptions): Runtime {
    const runtime = new Runtime(options, options.effectHandlers);

    runtime.ledger.append({
      type: 'mission.created',
      actor: PRINCIPAL,
      payload: { mission: options.mission },
    });

    for (const feature of options.features) {
      runtime.ledger.append({
        type: 'feature.registered',
        actor: INITIALIZER,
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

  isShutdown(): boolean {
    return project(this.ledger).shutdown;
  }

  async runFeature(featureId: string): Promise<RunResult> {
    if (this.isShutdown()) return { ok: false, reason: 'shutdown', featureId };

    const feature = project(this.ledger).features.get(featureId);
    if (!feature) return { ok: false, reason: `unknown-feature:${featureId}`, featureId };
    if (feature.passes) return { ok: false, reason: `already-passing:${featureId}`, featureId };

    const handler = this.handlers.find((candidate) => candidate.applies(feature));
    if (!handler) return { ok: false, reason: `no-effect-handler:${featureId}`, featureId };

    const claim = recordClaim(
      this.ledger,
      CODING,
      `Implement ${featureId}: ${feature.description}`,
    );

    const decision = this.authority.canAct(this.ledger, CODING, handler.scope, 'act');
    if (!decision.ok) {
      if (decision.approvalRequired) {
        const approved = await this.approve(handler.scope, claim.id);
        if (!approved) {
          this.ledger.append({
            type: 'approval.denied',
            actor: PRINCIPAL,
            payload: { scope: handler.scope, claimEventId: claim.id },
          });
          return { ok: false, reason: `approval-denied:${handler.scope}`, featureId };
        }
        this.ledger.append({
          type: 'approval.granted',
          actor: PRINCIPAL,
          payload: { scope: handler.scope, claimEventId: claim.id },
        });
      } else {
        return { ok: false, reason: decision.reason ?? 'not-authorized', featureId };
      }
    }

    const requested = this.ledger.append({
      type: 'effect.requested',
      actor: CODING,
      payload: { scope: handler.scope, featureId, requested: handler.describe(feature) },
      parent: claim.id,
    });

    this.ledger.append({
      type: 'checkpoint.created',
      actor: CODING,
      payload: { before: handler.snapshot(), featureId },
      parent: requested.id,
    });

    const actual = await handler.run(feature);
    this.ledger.append({
      type: 'effect.actualized',
      actor: CODING,
      payload: { scope: handler.scope, actual },
      parent: requested.id,
    });

    const probe = this.probes.get(handler.probeId);
    if (!probe) {
      await handler.revert(feature);
      this.ledger.append({
        type: 'effect.reverted',
        actor: VERIFIER,
        payload: { scope: handler.scope, featureId },
        parent: requested.id,
      });
      return { ok: false, reason: `missing-probe:${handler.probeId}`, featureId };
    }

    const evidenceEvent = await runProbe(this.ledger, VERIFIER, probe, claim.id);
    const evidence = project(this.ledger).evidence.get(evidenceEvent.id);

    if (evidence?.ok) {
      this.ledger.append({
        type: 'effect.verified',
        actor: VERIFIER,
        payload: { scope: handler.scope, featureId },
        parent: requested.id,
        evidence: evidenceEvent.id,
      });
      this.ledger.append({
        type: 'feature.updated',
        actor: VERIFIER,
        payload: { featureId, passes: true, evidenceEventId: evidenceEvent.id },
        parent: requested.id,
      });
      this.progress.append(`feature ${featureId} verified via ${probe.id}`);
      return { ok: true, featureId, eventId: evidenceEvent.id };
    }

    this.ledger.append({
      type: 'rollback.requested',
      actor: VERIFIER,
      payload: { featureId, checkpointEventId: requested.id },
      parent: requested.id,
    });
    await handler.revert(feature);
    this.ledger.append({
      type: 'effect.reverted',
      actor: VERIFIER,
      payload: { scope: handler.scope, featureId },
      parent: requested.id,
    });
    this.progress.append(`feature ${featureId} failed verification; rolled back`);
    return { ok: false, reason: 'verification-failed-and-rolled-back', featureId };
  }

  async runAll(): Promise<RunResult[]> {
    const results: RunResult[] = [];
    const features = project(this.ledger).features;
    for (const featureId of features.keys()) {
      if (this.isShutdown()) break;
      results.push(await this.runFeature(featureId));
    }
    return results;
  }

  metrics(): RuntimeMetrics {
    const state = project(this.ledger);
    const features = [...state.features.values()];
    const effects = [...state.effects.values()];
    return {
      totalFeatures: features.length,
      passingFeatures: features.filter((feature) => feature.passes).length,
      claims: state.claims.size,
      evidence: state.evidence.size,
      effects: effects.length,
      verifiedEffects: effects.filter((effect) => effect.status === 'verified').length,
      revertedEffects: effects.filter((effect) => effect.status === 'reverted').length,
      shutdown: state.shutdown,
    };
  }

  validate() {
    return validateLedger(this.ledger);
  }

  shutdown(reason = 'operator requested shutdown') {
    const event = this.ledger.append({
      type: 'shutdown.requested',
      actor: PRINCIPAL,
      payload: { reason },
    });
    this.progress.append(`shutdown: ${reason}`);
    return event;
  }

  save(): string | null {
    if (!this.storeDir) return null;
    return this.ledger.save(join(this.storeDir, 'ledger.jsonl'));
  }

  get codingAgent(): string {
    return CODING;
  }

  get verifier(): string {
    return VERIFIER;
  }

  get principal(): string {
    return PRINCIPAL;
  }

  mission(): Mission {
    return project(this.ledger).mission as Mission;
  }
}
