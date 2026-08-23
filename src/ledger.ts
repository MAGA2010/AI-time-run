/**
 * ledger.ts
 *
 * The append-only, event-sourced fact log. Current state is always a
 * projection of this log; the log itself is never mutated.
 */

import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import type { Event, EventType } from './types.js';

export interface AppendInput {
  type: EventType;
  actor: string;
  payload?: Record<string, unknown>;
  parent?: string;
  evidence?: string;
}

export class Ledger {
  private events: Event[] = [];
  private byId = new Map<string, Event>();
  private seq = 0;

  append(input: AppendInput): Event {
    const event: Event = {
      id: randomUUID(),
      seq: this.seq++,
      at: new Date().toISOString(),
      type: input.type,
      actor: input.actor,
      payload: input.payload ?? {},
      parent: input.parent,
      evidence: input.evidence,
    };
    this.events.push(event);
    this.byId.set(event.id, event);
    return event;
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

  /** Append-only durability: write the full log as JSONL. */
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
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const event = JSON.parse(trimmed) as Event;
      ledger.events.push(event);
      ledger.byId.set(event.id, event);
      ledger.seq = Math.max(ledger.seq, event.seq + 1);
    }
    return ledger;
  }
}
