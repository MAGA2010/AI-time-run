/**
 * session.ts
 *
 * Session is the append-only event ledger plus the read/replay/slice surface.
 * It is deliberately independent of any model context window: you can replay
 * the whole session, or slice a compact window to feed a fresh brain.
 */

import type { Ledger } from './ledger.js';
import { project } from './project.js';
import type { Event, EventType, Projection } from './types.js';

export interface SliceOptions {
  types?: EventType[];
  actor?: string;
  limit?: number;
  includeRetracted?: boolean;
}

export function replay(ledger: Ledger): Projection {
  return project(ledger);
}

export function slice(ledger: Ledger, options: SliceOptions = {}): Event[] {
  let events = [...ledger.all()];

  if (options.types && options.types.length > 0) {
    const wanted = new Set(options.types);
    events = events.filter((event) => wanted.has(event.type));
  }

  if (options.actor) {
    events = events.filter((event) => event.actor === options.actor);
  }

  if (!options.includeRetracted) {
    const state = project(ledger);
    events = events.filter((event) => {
      if (event.type === 'belief.asserted') {
        const belief = state.beliefs.get(event.id);
        return !belief?.retracted;
      }
      return true;
    });
  }

  if (options.limit !== undefined && events.length > options.limit) {
    events = events.slice(events.length - options.limit);
  }

  return events;
}

/** A compact, deterministic context string for the reasoner. */
export function summarize(ledger: Ledger, maxEvents = 40): string {
  const state = project(ledger);
  const lines: string[] = [];

  if (state.mission) {
    lines.push(`goal: ${state.mission.goal}`);
    lines.push(`boundary: ${state.mission.capabilityBoundary.join(', ')}`);
  }

  const passing = [...state.features.values()].filter((feature) => feature.passes).length;
  lines.push(`features: ${passing}/${state.features.size} passing`);
  lines.push(`shutdown: ${state.shutdown}`);

  const recent = slice(ledger, { limit: maxEvents });
  for (const event of recent) {
    lines.push(`${event.type} (${event.actor})`);
  }

  return lines.join('\n');
}
