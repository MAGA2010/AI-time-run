/**
 * evidence.ts
 *
 * Every model output enters the system as a Claim. It only becomes
 * Evidence once an observation or probe backs it. Claims and evidence live
 * in the same append-only ledger, which preserves the link between them.
 */

import type { Ledger } from './ledger.js';
import { isClaimVerified, project } from './project.js';
import type { Event } from './types.js';

export function recordClaim(
  ledger: Ledger,
  actor: string,
  statement: string,
  parent?: string,
): Event {
  return ledger.append({
    type: 'claim.recorded',
    actor,
    payload: { statement },
    parent,
  });
}

export function attachEvidence(
  ledger: Ledger,
  actor: string,
  claimId: string,
  source: string,
  kind: 'probe' | 'observation' | 'trace',
  ok: boolean,
  value: unknown,
): Event {
  return ledger.append({
    type: 'evidence.attached',
    actor,
    payload: { source, kind, ok, value },
    parent: claimId,
  });
}

export function isVerified(ledger: Ledger, claimId: string): boolean {
  return isClaimVerified(project(ledger), claimId);
}
