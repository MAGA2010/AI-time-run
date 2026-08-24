/**
 * reasoners/qa.ts
 *
 * BREAK 7 — QAReasoner: wraps a base Reasoner with a QA-Checker lane that
 * reviews the critic's verdict (per CodeAgent EMNLP 2024). In v1 the
 * QA-Checker is deterministic (length + on-topic heuristic); real brains
 * swap in an LLM call.
 */

import { randomUUID } from "node:crypto";

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

export interface QACheckVerdict {
  candidateId: string;
  onTopic: boolean;
  alignment: number; // 0..1
  reason: string;
}

export interface QAReasonerOptions extends BaseReasonerOptions {
  /** Sink for QA-Checker verdicts (writes to the ledger). */
  onQACheck?: (verdict: QACheckVerdict) => void;
  /** Optional alignment threshold; default 0.5. */
  minAlignment?: number;
}

export function makeQAReasoner(options: QAReasonerOptions = {}): Reasoner {
  const base = makeBaseReasoner(options);
  const minAlignment = options.minAlignment ?? 0.5;

  function qaCheck(candidate: Candidate, base2: Critique[], plan: Plan): QACheckVerdict {
    const onTopic = plan.claim.toLowerCase().includes("codeagent") ||
      candidate.content.toLowerCase().includes("plan");
    const alignment = Math.min(
      1,
      (candidate.content.length / 200) +
        (base2.filter((c) => c.ok).length / Math.max(1, base2.length)),
    );
    const verdict: QACheckVerdict = {
      candidateId: candidate.id,
      onTopic,
      alignment,
      reason: alignment >= minAlignment
        ? "qa-approve"
        : `qa-flag alignment=${alignment.toFixed(2)} below ${minAlignment}`,
    };
    options.onQACheck?.(verdict);
    return verdict;
  }

  return {
    plan: base.plan,
    generate: base.generate,
    async critique(candidate: Candidate, principles: Principle[], context: string): Promise<Critique[]> {
      const base2 = await base.critique(candidate, principles, context);
      // The QA-Checker piggybacks on plan context when available; otherwise
      // we mark the verdict with a synthetic plan reference.
      const syntheticPlan: Plan = {
        id: randomUUID(),
        featureId: "qa-feature",
        claim: candidate.content,
        steps: [],
      };
      qaCheck(candidate, base2, syntheticPlan);
      return base2;
    },
    evaluate: base.evaluate,
  };
}
