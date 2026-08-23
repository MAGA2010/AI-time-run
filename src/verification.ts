/**
 * verification.ts
 *
 * Verification is a probe plus an evidence event. A requested effect is
 * never trusted until an observer records ground truth in the ledger.
 */

import type { Ledger } from './ledger.js';
import { attachEvidence } from './evidence.js';
import type { Event, Probe } from './types.js';

export async function runProbe(
  ledger: Ledger,
  actor: string,
  probe: Probe,
  claimId: string,
): Promise<Event> {
  const result = await probe.run();
  return attachEvidence(
    ledger,
    actor,
    claimId,
    probe.id,
    'probe',
    result.ok,
    result.value,
  );
}
