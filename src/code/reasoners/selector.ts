/**
 * reasoners/selector.ts
 *
 * BREAK 7 — SelectorReasoner (v1): single-LLM multi-sample selector.
 * Generates N candidate samples and picks the most distinct one by content
 * length (proxy for TRAE-style syntax-based voting). Multi-provider parallel
 * sampling is deferred to v2 (BREAK 10).
 */

import type {
  Candidate,
  Critique,
  Evaluation,
  Mission,
  Plan,
  Principle,
  Reasoner,
} from "../../types.js";
import { makeBaseReasoner, type BaseReasonerOptions } from "./base.js";

export interface SelectorReasonerOptions extends BaseReasonerOptions {
  /** Number of samples per generate call (default 3). */
  n?: number;
}

export function makeSelectorReasoner(options: SelectorReasonerOptions = {}): Reasoner {
  const base = makeBaseReasoner(options);
  const n = options.n ?? 3;

  return {
    plan: base.plan,
    async generate(plan: Plan, context: string): Promise<Candidate> {
      const samples = await Promise.all(
        Array.from({ length: n }, () => base.generate(plan, context)),
      );
      // v1 picker: longest distinct content wins.
      const seen = new Map<string, Candidate>();
      for (const sample of samples) {
        const key = sample.content.trim();
        const prior = seen.get(key);
        if (!prior) {
          seen.set(key, sample);
        }
      }
      const distinct = [...seen.values()];
      const winner =
        distinct.sort((a, b) => b.content.length - a.content.length)[0] ?? samples[0];
      return winner;
    },
    critique: base.critique,
    evaluate: base.evaluate,
  };
}
