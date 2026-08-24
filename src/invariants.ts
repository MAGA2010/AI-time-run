/**
 * invariants.ts
 *
 * Defense-in-depth checks over the whole event log. The runtime constructs
 * valid histories, but these checks let a fresh context prove the history is
 * valid without trusting the code that wrote it.
 *
 * In addition to event-shape and authorization checks, the validator
 * re-walks the hash chain so a fresh verifier can prove no event was
 * inserted, deleted, or rewritten.
 */

import { GENESIS_HASH, sha256 } from './ledger.js';

function hashEvent(event: any): string {
  const canonical = JSON.stringify({
    id: event.id,
    seq: event.seq,
    type: event.type,
    actor: event.actor,
    parent: event.parent ?? null,
    evidence: event.evidence ?? null,
    payload: canonicalPayload(event.payload),
  });
  return sha256((event.prevHash && event.prevHash.length === 64 ? event.prevHash : GENESIS_HASH) + canonical);
}

function canonicalPayload(payload: unknown): unknown {
  if (payload === null || typeof payload !== 'object') return payload;
  if (Array.isArray(payload)) return (payload as unknown[]).map(canonicalPayload);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(payload as Record<string, unknown>).sort()) {
    out[key] = canonicalPayload((payload as Record<string, unknown>)[key]);
  }
  return out;
}
import type { Ledger } from './ledger.js';
import type { Event } from './types.js';

const LEVEL_RANK: Record<string, number> = { read: 1, act: 2, oversee: 3 };

export interface ValidationResult {
  ok: boolean;
  violations: string[];
  /** Count of events whose hash was independently recomputed. */
  chainChecked: number;
}

export function validateLedger(ledger: Ledger): ValidationResult {
  const violations: string[] = [];
  const events = ledger.all();
  const evidence = new Map<string, Event>();
  const grants = new Map<string, { actor: string; scope: string; level: number; revoked: boolean }>();

  let previousSeq = -1;
  let prevHash = GENESIS_HASH;
  let chainChecked = 0;

  for (const event of events) {
    if (event.seq !== previousSeq + 1) {
      violations.push(`append-order:${event.id}`);
    }
    previousSeq = event.seq;

    if (event.prevHash !== prevHash) {
      violations.push(`chain-broken:${event.id}:prevHash`);
    }
    const recomputed = hashEvent({ ...event, prevHash, hash: '' });
    if (recomputed !== event.hash) {
      violations.push(`chain-broken:${event.id}:hash`);
    }
    prevHash = event.hash;
    chainChecked += 1;

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

    if (event.type === 'effect.intent') {
      const intentKey = String(event.payload.idempotencyKey ?? '');
      const later = events.find((later) => later.type === 'effect.requested' && later.parent === event.id);
      if (later && intentKey && String(later.payload.idempotencyKey ?? '') !== intentKey) {
        violations.push(`intent-idempotency-mismatch:${later.id}`);
      }
    }

    if (event.type === 'effect.actualized' && event.parent) {
      const parent = ledger.get(event.parent);
      if (!parent || (parent.type !== 'effect.requested' && parent.type !== 'effect.intent')) {
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

    if (event.type === 'check.recorded') {
      const gaps = event.payload.gaps as unknown;
      if (gaps !== undefined && !Array.isArray(gaps)) {
        violations.push(`check-gaps-shape:${event.id}`);
      }
      if (typeof event.payload.version !== 'string') {
        violations.push(`check-version-missing:${event.id}`);
      }
    }
  }

  return { ok: violations.length === 0, violations, chainChecked };
}
