/**
 * ledger.ts
 *
 * The append-only, event-sourced fact log. Current state is always a
 * projection of this log; the log itself is never mutated.
 *
 * The ledger is also a tamper-evident hash chain (Write-Ahead Ledger):
 * every appended event carries prevHash and hash over a canonical form.
 * A fresh-context verifier can therefore prove both:
 *   1. The log is append-only in seq order.
 *   2. No event was inserted, deleted, or rewritten in between.
 *
 * On top of the chain we keep an idempotency index so re-execution of the
 * same intent (effect.intent, tool call, probe) collapses onto one event id.
 */

import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import type { Event, EventType } from './types.js';

export const GENESIS_HASH = '0'.repeat(64);

export interface AppendInput {
  type: EventType;
  actor: string;
  payload?: Record<string, unknown>;
  parent?: string;
  evidence?: string;
  idempotencyKey?: string;
}

export interface IdempotencyHit {
  key: string;
  firstEventId: string;
  seq: number;
}

export class Ledger {
  private events: Event[] = [];
  private byId = new Map<string, Event>();
  private byIdempotency = new Map<string, string>();
  private seq = 0;

  append(input: AppendInput): Event {
    if (input.idempotencyKey) {
      const previous = this.byIdempotency.get(input.idempotencyKey);
      if (previous) {
        const existing = this.byId.get(previous);
        if (existing) return existing;
      }
    }

    const prevHash = this.events.length === 0
      ? GENESIS_HASH
      : this.events[this.events.length - 1].hash;
    const seq = this.seq++;
    const id = randomUUID();
    const payload: Record<string, unknown> = { ...(input.payload ?? {}) };
    if (input.idempotencyKey) payload.idempotencyKey = input.idempotencyKey;
    const partial = {
      id,
      seq,
      at: new Date().toISOString(),
      type: input.type,
      actor: input.actor,
      payload,
      parent: input.parent,
      evidence: input.evidence,
      idempotencyKey: input.idempotencyKey,
    };
    const hash = hashEvent({ ...partial, prevHash, hash: '' });
    const event = { ...partial, prevHash, hash };

    this.events.push(event);
    this.byId.set(event.id, event);
    if (input.idempotencyKey) {
      this.byIdempotency.set(input.idempotencyKey, event.id);
    }
    return event;
  }

  findIdempotent(key: string): IdempotencyHit | undefined {
    const eventId = this.byIdempotency.get(key);
    if (!eventId) return undefined;
    const event = this.byId.get(eventId);
    if (!event) return undefined;
    return { key, firstEventId: eventId, seq: event.seq };
  }

  get length(): number {
    return this.events.length;
  }

  all(): readonly Event[] {
    return this.events;
  }

  get(id: string): Event | undefined {
    return this.byId.get(id);
  }

  filter(predicate: (event: Event) => boolean): Event[] {
    return this.events.filter(predicate);
  }

  byType(type: EventType): Event[] {
    return this.filter((event) => event.type === type);
  }

  head(): Event | undefined {
    return this.events[this.events.length - 1];
  }

  save(path: string): string {
    const target = resolve(path);
    mkdirSync(dirname(target), { recursive: true });
    const lines = this.events.map((event) => JSON.stringify(event)).join('\n');
    writeFileSync(target, lines + '\n', 'utf8');
    return target;
  }

  static load(path: string): Ledger {
    const target = resolve(path);
    const ledger = new Ledger();
    if (!existsSync(target)) return ledger;
    const raw = readFileSync(target, 'utf8');
    let prevHash = GENESIS_HASH;
    let seq = 0;
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const event = JSON.parse(trimmed);
      const recomputed = hashEvent({ ...event, prevHash, hash: '' });
      if (recomputed !== event.hash || event.prevHash !== prevHash) {
        throw new Error(
          `ledger-chain-broken: seq=${event.seq} expected=${prevHash} got=${event.prevHash}`,
        );
      }
      ledger.events.push(event);
      ledger.byId.set(event.id, event);
      seq = Math.max(seq, event.seq + 1);
      prevHash = event.hash;
    }
    ledger.seq = seq;
    return ledger;
  }

  static open(path: string): Ledger {
    const target = resolve(path);
    return existsSync(target) ? Ledger.load(target) : new Ledger();
  }
}

function hashEvent(event: Event): string {
  const canonical = JSON.stringify({
    id: event.id,
    seq: event.seq,
    type: event.type,
    actor: event.actor,
    parent: event.parent ?? null,
    evidence: event.evidence ?? null,
    payload: canonicalPayload(event.payload),
  });
  return createHash('sha256').update(prevHashHeader(event.prevHash) + canonical).digest('hex');
}

function prevHashHeader(prevHash: string): string {
  return prevHash && prevHash.length === 64 ? prevHash : GENESIS_HASH;
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

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function idempotencyKeyFor(parts: Record<string, unknown>): string {
  return sha256(JSON.stringify(canonicalPayload(parts)));
}
