/**
 * project.ts
 *
 * Rebuilds current state from the event log. This is the read model; no
 * business logic lives here, so replay always converges to the same state.
 */

import type { Ledger } from './ledger.js';
import type {
  CapabilityGrant,
  Claim,
  Effect,
  Evidence,
  Event,
  Feature,
  Mission,
  Projection,
} from './types.js';

function emptyProjection(): Projection {
  return {
    mission: null,
    grants: [],
    approvals: new Set<string>(),
    claims: new Map<string, Claim>(),
    evidence: new Map<string, Evidence>(),
    effects: new Map<string, Effect>(),
    features: new Map<string, Feature>(),
    checkpoints: [],
    shutdown: false,
  };
}

function asMission(payload: Record<string, unknown>): Mission {
  return payload.mission as Mission;
}

export function project(ledger: Ledger): Projection {
  const state = emptyProjection();

  for (const event of ledger.all()) {
    apply(state, event);
  }

  return state;
}

function apply(state: Projection, event: Event): void {
  const payload = event.payload;

  switch (event.type) {
    case 'mission.created':
      state.mission = asMission(payload);
      return;

    case 'grant.issued': {
      const grant: CapabilityGrant = {
        id: event.id,
        actor: String(payload.actor ?? event.actor),
        scope: String(payload.scope),
        level: payload.level as CapabilityGrant['level'],
        issuedBy: event.actor,
        issuedAt: event.at,
      };
      state.grants.push(grant);
      return;
    }

    case 'grant.revoked': {
      const grantId = String(payload.grantId);
      const grant = state.grants.find((item) => item.id === grantId);
      if (grant) grant.revokedAt = event.at;
      return;
    }

    case 'approval.granted':
      state.approvals.add(String(payload.scope));
      return;

    case 'claim.recorded':
      state.claims.set(event.id, {
        id: event.id,
        actor: event.actor,
        statement: String(payload.statement),
        evidenceIds: [],
      });
      return;

    case 'evidence.attached': {
      const evidence: Evidence = {
        id: event.id,
        claimId: event.parent,
        source: String(payload.source),
        kind: payload.kind as Evidence['kind'],
        ok: Boolean(payload.ok),
        value: payload.value,
      };
      state.evidence.set(event.id, evidence);
      if (event.parent) {
        const claim = state.claims.get(event.parent);
        if (claim) claim.evidenceIds.push(event.id);
      }
      return;
    }

    case 'effect.requested':
      state.effects.set(event.id, {
        id: event.id,
        scope: String(payload.scope),
        featureId: payload.featureId as string | undefined,
        requested: String(payload.requested),
        status: 'requested',
      });
      return;

    case 'effect.actualized': {
      const effect = event.parent ? state.effects.get(event.parent) : undefined;
      if (effect) {
        effect.actual = String(payload.actual);
        effect.status = 'actualized';
      }
      return;
    }

    case 'effect.verified': {
      const effect = event.parent ? state.effects.get(event.parent) : undefined;
      if (effect) effect.status = 'verified';
      return;
    }

    case 'effect.reverted': {
      const effect = event.parent ? state.effects.get(event.parent) : undefined;
      if (effect) effect.status = 'reverted';
      return;
    }

    case 'checkpoint.created':
      state.checkpoints.push(event);
      return;

    case 'feature.registered':
      state.features.set(String(payload.featureId), {
        id: String(payload.featureId),
        description: String(payload.description),
        steps: (payload.steps as string[]) ?? [],
        passes: false,
      });
      return;

    case 'feature.updated': {
      const feature = state.features.get(String(payload.featureId));
      if (feature) {
        feature.passes = Boolean(payload.passes);
        feature.evidenceEventId = payload.evidenceEventId as string | undefined;
      }
      return;
    }

    case 'shutdown.requested':
      state.shutdown = true;
      return;

    default:
      return;
  }
}

/** A claim is verified only when at least one evidence event references it. */
export function isClaimVerified(state: Projection, claimId: string): boolean {
  const claim = state.claims.get(claimId);
  return Boolean(claim && claim.evidenceIds.length > 0);
}
