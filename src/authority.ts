/**
 * authority.ts
 *
 * Authority is enforced data, not code. Grants are monotonic events that can
 * only be revoked with a tombstone; high-impact scopes require an approval
 * event before they can act.
 */

import { randomUUID } from 'node:crypto';

import type { Ledger } from './ledger.js';
import { project } from './project.js';
import type {
  AuthorityDecision,
  CapabilityGrant,
  Event,
} from './types.js';

const LEVEL_RANK: Record<CapabilityGrant['level'], number> = {
  read: 1,
  act: 2,
  oversee: 3,
};

export interface ApprovalGate {
  scope: string;
  id: string;
}

export class AuthorityEngine {
  private gates = new Map<string, string>();

  constructor(gates: ApprovalGate[] = []) {
    for (const gate of gates) this.gates.set(gate.scope, gate.id);
  }

  issueGrant(
    ledger: Ledger,
    issuer: string,
    actor: string,
    scope: string,
    level: CapabilityGrant['level'],
  ): Event {
    return ledger.append({
      type: 'grant.issued',
      actor: issuer,
      payload: { actor, scope, level, grantId: randomUUID() },
    });
  }

  revokeGrant(ledger: Ledger, revoker: string, grantId: string): Event | null {
    const active = project(ledger).grants.find(
      (grant) => grant.id === grantId && !grant.revokedAt,
    );
    if (!active) return null;
    return ledger.append({
      type: 'grant.revoked',
      actor: revoker,
      payload: { grantId },
    });
  }

  /**
   * Decides whether `actor` may take an `act`-level action in `scope`.
   * A missing approval for a gated scope does not deny; it defers to the
   * caller to run the human approval hook.
   */
  canAct(
    ledger: Ledger,
    actor: string,
    scope: string,
    level: CapabilityGrant['level'] = 'act',
  ): AuthorityDecision {
    const state = project(ledger);
    const active = state.grants.filter(
      (grant) =>
        grant.actor === actor &&
        grant.scope === scope &&
        !grant.revokedAt &&
        LEVEL_RANK[grant.level] >= LEVEL_RANK[level],
    );

    if (active.length === 0) {
      return { ok: false, reason: `no-capability-grant:${scope}` };
    }

    if (this.gates.has(scope) && !state.approvals.has(scope)) {
      return {
        ok: false,
        reason: `approval-gate:${this.gates.get(scope)}`,
        approvalRequired: true,
      };
    }

    return { ok: true };
  }
}
