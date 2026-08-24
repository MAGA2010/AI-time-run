/**
 * evolver.ts
 *
 * MDIBUS 09 / Life-Harness: a self-evolving harness. Recurring failure
 * attributions are not just logged; when a failure type repeats past a
 * threshold, the runtime amends its own constitution with a new principle,
 * so the next run is rejected before it can make the same mistake again.
 *
 * Misevolution guardrails (Your Agent May Misevolve, arXiv 2509.26354):
 *   - One rule per failure-type per cooldown window (no flood amendments).
 *   - Regression gate: callers may plug a regression EvalSuite; if amending
 *     the constitution regresses any prior passed feature, the amendment
 *     is refused and an oversight.escalated event is appended.
 *   - Every amendment payload now carries the supporting evidence ids,
 *     evaluation sample ids, and the textual diff between old/new principles
 *     so a fresh-context auditor can prove the change is grounded.
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

export interface RegressionEvalResult {
  ok: boolean;
  sampleIds?: string[];
}

export type RegressionEval = (
  candidate: { id: string; statement: string; failureType: string },
) => RegressionEvalResult | Promise<RegressionEvalResult>;

export interface EvolveOptions {
  threshold?: number;
  cooldownMs?: number;
  regressionEval?: RegressionEval;
}

export interface EvolveResult {
  learned: string[];
  refused: string[];
}

interface CooldownEntry {
  type: string;
  amendedAt: number;
}

export class HarnessEvolver {
  private cooldowns: CooldownEntry[] = [];

  async evolve(
    ledger: Ledger,
    constitution: Constitution,
    thresholdOrOptions: number | EvolveOptions = 2,
  ): Promise<string[]> {
    return (await this.evolveDetailed(ledger, constitution, thresholdOrOptions)).learned;
  }

  async evolveDetailed(
    ledger: Ledger,
    constitution: Constitution,
    thresholdOrOptions: number | EvolveOptions = 2,
  ): Promise<EvolveResult> {
    const opts: EvolveOptions =
      typeof thresholdOrOptions === 'number'
        ? { threshold: thresholdOrOptions }
        : thresholdOrOptions;
    const threshold = opts.threshold ?? 2;
    const cooldownMs = opts.cooldownMs ?? 60_000;

    const counts = new Map<string, number>();
    const sampleIdsByType = new Map<string, string[]>();
    for (const event of ledger.byType('failure.attributed')) {
      const type = String(event.payload.failureType ?? 'unknown');
      counts.set(type, (counts.get(type) ?? 0) + 1);
      const sampleIds = sampleIdsByType.get(type) ?? [];
      if (event.id) sampleIds.push(event.id);
      sampleIdsByType.set(type, sampleIds);
    }

    const amended = new Set(
      ledger
        .byType('constitution.amended')
        .map((event) => String(event.payload.failureType)),
    );

    const now = Date.now();
    const recentAmendments = new Set(
      this.cooldowns
        .filter((entry) => now - entry.amendedAt < cooldownMs)
        .map((entry) => entry.type),
    );

    const learned: string[] = [];
    const refused: string[] = [];

    for (const [type, count] of counts) {
      if (count < threshold || amended.has(type) || recentAmendments.has(type)) continue;

      const statement = STATEMENTS[type] ?? STATEMENTS.unknown;
      const principle = { id: `learned:${type}`, statement };
      const candidate = { id: principle.id, statement, failureType: type };
      let evalSamples: string[] = [];

      if (opts.regressionEval) {
        try {
          const result = await Promise.resolve(opts.regressionEval(candidate));
          evalSamples = result.sampleIds ?? [];
          if (!result.ok) {
            ledger.append({
              type: 'oversight.escalated',
              actor: 'observer',
              payload: {
                reason: 'regression-gate-refused-amendment',
                failureType: type,
                principleId: principle.id,
                evalSamples: result.sampleIds ?? [],
              },
            });
            refused.push(type);
            continue;
          }
        } catch (error) {
          ledger.append({
            type: 'oversight.escalated',
            actor: 'observer',
            payload: {
              reason: 'regression-eval-threw',
              failureType: type,
              error: error instanceof Error ? error.message : String(error),
            },
          });
          refused.push(type);
          continue;
        }
      }

      const diff = {
        before: null,
        after: principle.statement,
        failureType: type,
        count,
      };

      constitution.add(principle);
      this.cooldowns.push({ type, amendedAt: now });
      ledger.append({
        type: 'constitution.amended',
        actor: 'observer',
        payload: {
          failureType: type,
          count,
          principleId: principle.id,
          statement,
          evidenceEventIds: sampleIdsByType.get(type) ?? [],
          evalSampleIds: evalSamples,
          diff,
          cooldownMs,
        },
      });
      learned.push(statement);
    }

    return { learned, refused };
  }
}
