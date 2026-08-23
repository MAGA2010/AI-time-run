/**
 * oversight.ts
 *
 * Metrics and blind-spot detection. The monitor watches the agent, but it
 * also watches itself: any passing feature that is not traceable end-to-end
 * through plan, critique, and evidence is reported as a blind spot.
 */

import type { Ledger } from './ledger.js';
import { project } from './project.js';
import type { OversightMetrics } from './types.js';

export class Oversight {
  constructor(private ledger: Ledger) {}

  metrics(): OversightMetrics {
    const state = project(this.ledger);
    const features = [...state.features.values()];
    const effects = [...state.effects.values()];
    const beliefs = [...state.beliefs.values()];

    return {
      totalFeatures: features.length,
      passingFeatures: features.filter((feature) => feature.passes).length,
      plans: state.plans.size,
      candidates: state.candidates.size,
      critiques: state.critiques.size,
      revisions: this.ledger.byType('revision.requested').length,
      claims: state.claims.size,
      evidence: state.evidence.size,
      effects: effects.length,
      verifiedEffects: effects.filter((effect) => effect.status === 'verified').length,
      revertedEffects: effects.filter((effect) => effect.status === 'reverted').length,
      beliefs: beliefs.length,
      retractedBeliefs: beliefs.filter((belief) => belief.retracted).length,
      blindSpots: this.blindSpots().length,
      shutdown: state.shutdown,
    };
  }

  blindSpots(): string[] {
    const state = project(this.ledger);
    const blindSpots: string[] = [];

    for (const feature of state.features.values()) {
      if (!feature.passes) continue;

      if (!feature.evidenceEventId) {
        blindSpots.push(`pass-without-evidence:${feature.id}`);
      }

      const planned = [...state.plans.values()].some(
        (plan) => plan.featureId === feature.id,
      );
      if (!planned) {
        blindSpots.push(`pass-without-plan:${feature.id}`);
      }

      const reviewed = [...state.critiques.values()].some(
        (record) => record.ok,
      );
      if (!reviewed) {
        blindSpots.push(`pass-without-critique:${feature.id}`);
      }
    }

    return blindSpots;
  }
}
