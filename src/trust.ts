/**
 * trust.ts
 *
 * MDIBUS 05: semantic trust gateway. Untrusted content cannot mutate trust;
 * only evidence from trusted kinds (probe/observation) may flip authority,
 * beliefs, or feature state.
 */

import type { Evidence, TrustAssessment } from './types.js';

export class TrustGateway {
  private trustedKinds: Set<string>;

  constructor(trustedKinds: Iterable<string> = ['probe', 'observation']) {
    this.trustedKinds = new Set(trustedKinds);
  }

  assess(evidence: Evidence): TrustAssessment {
    const trusted = evidence.ok && this.trustedKinds.has(evidence.kind);
    return {
      ok: trusted,
      trust: trusted ? 'trusted' : 'untrusted',
      reason: trusted ? 'trusted evidence' : 'untrusted or failed evidence',
    };
  }

  canMutateTrust(evidence: Evidence): boolean {
    return this.assess(evidence).trust === 'trusted';
  }
}
