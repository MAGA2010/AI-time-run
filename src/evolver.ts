/**
 * evolver.ts
 *
 * MDIBUS 09 / Life-Harness: a self-evolving harness. Recurring failure
 * attributions are not just logged; when a failure type repeats past a
 * threshold, the runtime amends its own constitution with a new principle,
 * so the next run is rejected before it can make the same mistake again.
 */

import type { Constitution } from './constitution.js';
import type { Ledger } from './ledger.js';

const STATEMENTS: Record<string, string> = {
  tool: 'Do not request a tool call that previously failed without a verified workaround.',
  verify: 'A feature must pass an independent deterministic check before it may pass.',
  feedback: 'Every effect must be backed by an observable probe; a missing probe is a hard failure.',
  model: 'Do not propose candidates that violate the constitution.',
  context: 'Select context that covers the stated requirements before acting.',
  recovery: 'Checkpoint before any high-impact effect so it can be reverted.',
  entropy: 'Remove generated residue before declaring completion.',
  unknown: 'Attribute the failure before retrying.',
};

export class HarnessEvolver {
  evolve(
    ledger: Ledger,
    constitution: Constitution,
    threshold = 2,
  ): string[] {
    const counts = new Map<string, number>();
    for (const event of ledger.byType('failure.attributed')) {
      const type = String(event.payload.failureType ?? 'unknown');
      counts.set(type, (counts.get(type) ?? 0) + 1);
    }

    const amended = new Set(
      ledger
        .byType('constitution.amended')
        .map((event) => String(event.payload.failureType)),
    );

    const learned: string[] = [];
    for (const [type, count] of counts) {
      if (count < threshold || amended.has(type)) continue;

      const statement = STATEMENTS[type] ?? STATEMENTS.unknown;
      const principle = { id: `learned:${type}`, statement };
      constitution.add(principle);
      ledger.append({
        type: 'constitution.amended',
        actor: 'observer',
        payload: {
          failureType: type,
          count,
          principleId: principle.id,
          statement,
        },
      });
      learned.push(statement);
    }

    return learned;
  }
}

