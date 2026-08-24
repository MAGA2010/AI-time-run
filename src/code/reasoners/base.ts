/**
 * reasoners/base.ts
 *
 * BREAK 7 — minimal in-process Reasoner that produces pseudo-code plans.
 * This is the v1 reference brain: deterministic, no network, no API key,
 * and intentionally tiny so the harness architecture can be exercised
 * end-to-end. Real LLM-backed brains slot in here unchanged.
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
import type { PseudoCodePlan, PseudoCodeStep } from "../../types.js";

export interface BaseReasonerOptions {
  /** When true, also emit a `code.plan_recorded` event via the optional sink. */
  recordPseudoCode?: (plan: PseudoCodePlan) => void;
}

function pseudoCodeFromDescription(description: string): PseudoCodeStep[] {
  // Deterministic v1: split the description into act/observe/assert steps
  // based on simple keyword detection. Real brains replace this.
  const steps: PseudoCodeStep[] = [];
  const lower = description.toLowerCase();
  if (lower.includes("search") || lower.includes("find")) {
    steps.push({ kind: "act", tool: "code.search", input: { pattern: "<derive>" } });
  }
  if (lower.includes("symbol") || lower.includes("function") || lower.includes("class")) {
    steps.push({ kind: "act", tool: "code.symbol_nav", input: { symbol: "<derive>", kind: "def" } });
    steps.push({ kind: "observe", probe: "code.cell.ok" });
  }
  if (lower.includes("format") || lower.includes("style")) {
    steps.push({ kind: "act", tool: "code.format", input: { files: ["<derive>"] } });
  }
  if (lower.includes("execute") || lower.includes("run") || lower.includes("compute")) {
    steps.push({
      kind: "act",
      tool: "code.repl",
      input: { code: "<derive>" },
    });
    steps.push({ kind: "assert", predicate: "returncode == 0", onFail: "retry" });
  }
  if (steps.length === 0) {
    steps.push({ kind: "act", tool: "code.search", input: { pattern: "<derive>" } });
    steps.push({ kind: "assert", predicate: "matches.length > 0", onFail: "rollback" });
  }
  return steps;
}

export function makeBaseReasoner(options: BaseReasonerOptions = {}): Reasoner {
  return {
    plan(mission: Mission, features, _context): Plan {
      const feature = features[0];
      const claim = `${mission.goal} :: ${feature.description}`;
      const steps = pseudoCodeFromDescription(feature.description).map((s) =>
        JSON.stringify(s),
      );
      const pseudoPlan: PseudoCodePlan = {
        id: randomUUID(),
        featureId: feature.id,
        claim,
        steps: pseudoCodeFromDescription(feature.description),
      };
      options.recordPseudoCode?.(pseudoPlan);
      return {
        id: pseudoPlan.id,
        featureId: feature.id,
        claim,
        steps,
      };
    },

    generate(plan: Plan, _context): Candidate {
      const content = `# Plan ${plan.id} for ${plan.featureId}\n${plan.steps.join("\n")}\n`;
      return { id: randomUUID(), planId: plan.id, content };
    },

    critique(_candidate: Candidate, principles: Principle[], _context): Critique[] {
      // v1: trivially approve; the constitution in the orchestrator does the real check.
      return principles.map((p) => ({ principleId: p.id, ok: true, reason: "base-approve" }));
    },

    evaluate(_candidate, _evidence, _context): Evaluation {
      return { ok: true, summary: "base-evaluate" };
    },
  };
}
