/**
 * oversight.ts
 *
 * Metrics and blind-spot detection. The monitor watches the agent, but it
 * also watches itself: any passing feature that is not traceable end-to-end
 * through plan, critique, and evidence is reported as a blind spot.
 */

import type { Ledger } from './ledger.js';
import { project } from './project.js';
import { validateLedger } from './invariants.js';
import type { OversightMetrics } from './types.js';

export class Oversight {
  constructor(private ledger: Ledger) {}

  metrics(): OversightMetrics {
    const state = project(this.ledger);
    const features = [...state.features.values()];
    const effects = [...state.effects.values()];
    const beliefs = [...state.beliefs.values()];
    const interventions = this.ledger.byType('intervention.recorded');
    const entropyEvent = this.ledger.byType('entropy.audited').at(-1);

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
      failureAttributions: this.ledger.byType('failure.attributed').length,
      interventions: interventions.length,
      avoidableInterventions: interventions.filter((event) =>
        Boolean(event.payload.avoidable),
      ).length,
      entropyScore: Number(entropyEvent?.payload.score ?? 0),
      shutdown: state.shutdown,
    };
  }

  blindSpots(): string[] {
    const state = project(this.ledger);
    const blindSpots: string[] = [];

    const reviewedFeatureIds = new Set<string>();
    for (const critique of state.critiques.values()) {
      if (!critique.ok) continue;
      const candidate = state.candidates.get(critique.candidateId);
      const plan = candidate ? state.plans.get(candidate.planId) : undefined;
      if (plan) reviewedFeatureIds.add(plan.featureId);
    }

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

      if (!reviewedFeatureIds.has(feature.id)) {
        blindSpots.push(`pass-without-critique:${feature.id}`);
      }
    }

    return blindSpots;
  }

  /**
   * MDIBUS 09: cross-layer escalation. Persistent blind spots or invariant
   * violations are not just reported; they trigger revocation of the affected
   * capability and are recorded as a first-class escalation event.
   */
  escalate(): { escalated: boolean; actions: string[] } {
    const violations = validateLedger(this.ledger).violations;
    const blindSpots = this.blindSpots();
    if (violations.length === 0 && blindSpots.length === 0) {
      return { escalated: false, actions: [] };
    }

    const scopes = new Set<string>();
    for (const violation of violations) {
      if (violation.startsWith('unauthorized-effect:')) {
        const scope = violation.split(':').at(-1);
        if (scope) scopes.add(scope);
      }
    }

    const state = project(this.ledger);
    const actions: string[] = [];
    for (const grant of state.grants) {
      if (grant.revokedAt) continue;
      if (scopes.has(grant.scope)) {
        this.ledger.append({
          type: 'grant.revoked',
          actor: 'observer',
          payload: { grantId: grant.id },
        });
        actions.push(`revoke:${grant.scope}`);
      }
    }

    this.ledger.append({
      type: 'oversight.escalated',
      actor: 'observer',
      payload: { blindSpots, violations, actions },
    });

    return { escalated: true, actions };
  }
}
