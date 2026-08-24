/**
 * invariants.ts
 *
 * Defense-in-depth checks over the whole event log. The runtime constructs
 * valid histories, but these checks let a fresh context prove the history is
 * valid without trusting the code that wrote it.
 */

import type { Ledger } from './ledger.js';
import type { Event } from './types.js';

const LEVEL_RANK: Record<string, number> = { read: 1, act: 2, oversee: 3 };

export interface ValidationResult {
  ok: boolean;
  violations: string[];
}

export function validateLedger(ledger: Ledger): ValidationResult {
  const violations: string[] = [];
  const events = ledger.all();
  const evidence = new Map<string, Event>();
  const grants = new Map<string, { actor: string; scope: string; level: number; revoked: boolean }>();

  let previousSeq = -1;
  for (const event of events) {
    if (event.seq !== previousSeq + 1) {
      violations.push(`append-order:${event.id}`);
    }
    previousSeq = event.seq;

    if (event.type === 'evidence.attached') evidence.set(event.id, event);
  }

  for (const event of events) {
    if (event.type === 'grant.issued') {
      grants.set(String(event.payload.grantId ?? event.id), {
        actor: String(event.payload.actor ?? event.actor),
        scope: String(event.payload.scope),
        level: LEVEL_RANK[String(event.payload.level)] ?? 0,
        revoked: false,
      });
      continue;
    }

    if (event.type === 'grant.revoked') {
      const grant = grants.get(String(event.payload.grantId));
      if (grant) grant.revoked = true;
      continue;
    }

    if (event.type === 'effect.requested') {
      const actor = event.actor;
      const scope = String(event.payload.scope);
      const covered = [...grants.values()].some(
        (grant) =>
          grant.actor === actor &&
          grant.scope === scope &&
          !grant.revoked &&
          grant.level >= LEVEL_RANK.act,
      );
      if (!covered) violations.push(`unauthorized-effect:${event.id}:${scope}`);
    }

    if (event.type === 'effect.actualized' && event.parent) {
      const parent = ledger.get(event.parent);
      if (!parent || parent.type !== 'effect.requested') {
        violations.push(`orphan-effect:${event.id}`);
      }
    }

    if (event.type === 'effect.verified') {
      const backing = event.evidence ? evidence.get(event.evidence) : undefined;
      if (!backing || backing.payload.ok !== true) {
        violations.push(`unverified-effect:${event.id}`);
      }
    }

    if (event.type === 'feature.updated' && event.payload.passes === true) {
      const backingId = event.payload.evidenceEventId as string | undefined;
      const backing = backingId ? evidence.get(backingId) : undefined;
      if (!backing || backing.payload.ok !== true) {
        violations.push(`unverified-feature-pass:${String(event.payload.featureId)}`);
      }
    }
  }

  return { ok: violations.length === 0, violations };
}
