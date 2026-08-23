/**
 * identity.ts
 *
 * MDIBUS 04: Identity Engine. Actors stop being bare strings; each is bound
 * to an identity with a role and a trust domain. Selective handshake only
 * admits an actor when its declared trust domain matches the bound identity.
 */

import { randomUUID } from 'node:crypto';

import type { Ledger } from './ledger.js';
import type { Event } from './types.js';

export interface Identity {
  id: string;
  actor: string;
  role: string;
  trustDomain: string;
  boundAt: string;
}

export class IdentityEngine {
  private identities = new Map<string, Identity>();
  private admitted = new Set<string>();

  bind(actor: string, role: string, trustDomain: string): Identity {
    const identity: Identity = {
      id: randomUUID(),
      actor,
      role,
      trustDomain,
      boundAt: new Date().toISOString(),
    };
    this.identities.set(actor, identity);
    return identity;
  }

  recordBind(
    ledger: Ledger,
    actor: string,
    role: string,
    trustDomain: string,
  ): Event {
    const identity = this.bind(actor, role, trustDomain);
    return ledger.append({
      type: 'identity.bound',
      actor,
      payload: { actor, role, trustDomain, identityId: identity.id },
    });
  }

  /** Selective handshake: admit only when the trust domain matches. */
  handshake(actor: string, trustDomain: string): boolean {
    const identity = this.identities.get(actor);
    if (!identity || identity.trustDomain !== trustDomain) return false;
    this.admitted.add(actor);
    return true;
  }

  verify(actor: string): Identity | null {
    return this.identities.get(actor) ?? null;
  }

  all(): readonly Identity[] {
    return [...this.identities.values()];
  }
}

