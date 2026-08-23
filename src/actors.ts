/**
 * actors.ts
 *
 * Role identities plus the default deterministic reasoner. The reasoner is
 * the only place a real deployment swaps in an LLM; the harness and sandbox
 * are model-agnostic.
 */

import { randomUUID } from 'node:crypto';

import type {
  Candidate,
  Critique,
  Evaluation,
  Evidence,
  Feature,
  Mission,
  Plan,
  Principle,
  Reasoner,
} from './types.js';

export const ROLES = {
  principal: 'principal',
  initializer: 'initializer',
  planner: 'planner',
  generator: 'generator',
  critic: 'critic',
  evaluator: 'evaluator',
  observer: 'observer',
} as const;

export class DefaultReasoner implements Reasoner {
  plan(mission: Mission, features: Feature[]): Plan {
    const next = features.find((feature) => !feature.passes);
    if (!next) {
      return {
        id: randomUUID(),
        featureId: 'none',
        claim: 'no remaining features',
        steps: [],
      };
    }
    return {
      id: randomUUID(),
      featureId: next.id,
      claim: `Implement ${next.id}: ${next.description}`,
      steps: next.steps,
    };
  }

  generate(plan: Plan): Candidate {
    return {
      id: randomUUID(),
      planId: plan.id,
      content: `${plan.claim}\n${plan.steps.map((step) => `- ${step}`).join('\n')}`,
    };
  }

  critique(_candidate: Candidate, principles: Principle[]): Critique[] {
    return principles.map((principle) => ({
      principleId: principle.id,
      ok: true,
      reason: `satisfies: ${principle.statement}`,
    }));
  }

  evaluate(_candidate: Candidate, evidence: Evidence[]): Evaluation {
    const ok = evidence.length > 0 && evidence.every((item) => item.ok);
    return { ok, summary: ok ? 'evidence-backed' : 'missing or failed evidence' };
  }
}
