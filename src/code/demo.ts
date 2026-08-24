/**
 * code/demo.ts
 *
 * BREAK 7 — `codeagent` demo scenario. Exercises the full CodeAgent stack:
 * - CodeActInterpreter (Python subprocess per feature)
 * - CodeToolSet (5 tools)
 * - PseudoCodeReasoner (record pseudo-code plans as `code.plan_recorded`)
 * - SelfDebugLoop (replaces immediate rollback on cell failure)
 * - Sandbox escalation heuristic
 *
 * Variants:
 *   - `codeact`        : Plan -> REPL -> evidence -> pass
 *   - `self-debug`     : First cell fails; SelfDebugLoop retries with refinement
 *   - `qa-review`      : QAReasoner adds an extra actor lane
 *
 * The demo runs in-memory by default; pass `--store <dir>` to persist the ledger.
 */

import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { ManagedRuntime } from "../orchestrator.js";
import { ROLES } from "../actors.js";
import type { FeatureSpec, Probe, Tool } from "../types.js";

import {
  CodeActInterpreter,
  isLikelySandboxDenied,
  makeApplyPatchTool,
  makeDocTool,
  makeFormatTool,
  makeSearchTool,
  makeSymbolNavTool,
} from "./index.js";
import { makeBaseReasoner, makeQAReasoner, makeSelectorReasoner } from "./reasoners/index.js";
import { SelfDebugLoop } from "./self_debug.js";

export type CodeAgentVariant = "codeact" | "self-debug" | "qa-review";

export interface CodeAgentDemoOptions {
  storeDir?: string;
  variant?: CodeAgentVariant;
  repoRoot?: string;
  workspaceRoot?: string;
}

function makeFeatures(variant: CodeAgentVariant): FeatureSpec[] {
  if (variant === "self-debug") {
    return [
      {
        id: "fix-factorial",
        description: "Fix a Python function `factorial` that fails on n=0; self-debug if first attempt errors",
        steps: ["search for factorial", "edit to handle n=0", "verify factorial(0) == 1"],
      },
    ];
  }
  if (variant === "qa-review") {
    return [
      {
        id: "review-patch",
        description: "Review a candidate patch for symbol navigation; QA-Checker cross-validates",
        steps: ["search", "navigate symbol", "qa-check verdict"],
      },
    ];
  }
  return [
    {
      id: "codeagent-smoke",
      description: "Plan + execute a Python computation in a stateful kernel",
      steps: ["plan", "execute", "verify"],
    },
  ];
}

function makeProbes(): Probe[] {
  return [
    {
      id: "code-probe",
      run: () => ({ ok: true, value: { ok: true } }),
    },
  ];
}

function buildTools(repoRoot: string, interpreter: CodeActInterpreter): Tool[] {
  const tools: Tool[] = [];
  if (repoRoot) {
    tools.push(makeSearchTool(repoRoot));
    tools.push(makeDocTool(repoRoot));
    tools.push(makeSymbolNavTool(repoRoot));
    tools.push(makeFormatTool(repoRoot, "prettier"));
    tools.push(makeApplyPatchTool(repoRoot));
  }
  tools.push(interpreter.asTool());
  return tools;
}

export async function runCodeAgentDemo(options: CodeAgentDemoOptions = {}): Promise<{
  runtime: ManagedRuntime;
  variant: CodeAgentVariant;
  cellsExecuted: number;
  interpreter: CodeActInterpreter;
}> {
  const variant: CodeAgentVariant = options.variant ?? "codeact";
  const repoRoot = options.repoRoot ?? process.cwd();
  const workspaceRoot = options.workspaceRoot ?? join(options.storeDir ?? process.cwd(), ".store", "kernels");

  const interpreter = new CodeActInterpreter({
    pythonBin: process.env.AI_TIME_RUN_PYTHON ?? "python3",
    workspaceRoot,
    cellTimeoutMs: 10_000,
    idleTimeoutMs: 0, // do not auto-kill during demo
  });

  // Record pseudo-code plans into the ledger via the reasoner sink.
  let cellsExecuted = 0;

  const baseReasoner = makeBaseReasoner({});

  const reasoner =
    variant === "qa-review"
      ? makeQAReasoner({})
      : variant === "self-debug"
        ? makeBaseReasoner({})
        : makeSelectorReasoner({ n: 3 });

  const features = makeFeatures(variant);
  const probes = makeProbes();
  const tools = buildTools(repoRoot, interpreter);

  const mission = {
    id: `codeagent-${variant}-${randomUUID().slice(0, 8)}`,
    goal: `Run ${variant} variant of the BREAK 7 CodeAgent demo`,
    protectedIntentions: [
      "Do not rewrite the principal intent.",
      "All code.repl cells must end with a positive assertion.",
    ],
    capabilityBoundary: ["repo.read", "repo.write", "sandbox.exec"],
    approvalThreshold: "high-impact" as const,
    manifest: {
      mounts: [
        { path: "/repo", source: repoRoot, mode: "read-only" as const },
        { path: "/kernels", source: workspaceRoot, mode: "read-write" as const, ephemeral: false },
      ],
      dependencies: [{ name: "python3", manager: "pip" as const }],
    },
  };

  const runtime = ManagedRuntime.create({
    mission,
    features,
    grants: [
      { id: "g-read", actor: ROLES.generator, scope: "repo.read", level: "act" as const, issuedBy: ROLES.principal, issuedAt: "" },
      { id: "g-write", actor: ROLES.generator, scope: "repo.write", level: "act" as const, issuedBy: ROLES.principal, issuedAt: "" },
      { id: "g-exec", actor: ROLES.generator, scope: "sandbox.exec", level: "act" as const, issuedBy: ROLES.principal, issuedAt: "" },
    ],
    principles: [
      { id: "safe", statement: "must not call untrusted tools" },
      { id: "scoped", statement: "must stay within the mission boundary" },
    ],
    reasoner,
    bindings: features.map((feature) => ({
      featureId: feature.id,
      toolName: "code.repl",
      probeId: "code-probe",
      scope: "sandbox.exec",
    })),
    tools,
    probes,
    highImpactScopes: new Set(["repo.write", "sandbox.exec"]),
    approve: async (scope, detail) => {
      if (scope === "repo.write" && isLikelySandboxDenied({ ok: false, error: detail })) {
        return false; // would escalate to `code.escalate`
      }
      return true;
    },
    storeDir: options.storeDir,
  });

  // Run a single CodeAct cell per feature to exercise the interpreter and
  // the pseudo-code planner. The demo intentionally avoids depending on
  // Python being installed: if `python3` is missing, the cell fails fast
  // and the failure is attributed cleanly (BREAK 7 keeps the run auditable).
  await runtime.runAll();

  // After the loop, if the variant is self-debug, exercise the SelfDebugLoop
  // explicitly to record its event trail in the ledger.
  if (variant === "self-debug") {
    const feature = features[0];
    const failureEvent = runtime.ledger.head();
    if (failureEvent) {
      const loop = new SelfDebugLoop(
        runtime.ledger,
        interpreter,
        {
          explain: async () =>
            `The kernel failed because factorial(0) is not handled; add the base case and retry.`,
          refine: async (_failure, _explanation, attempt) => {
            cellsExecuted++;
            if (attempt === 1) {
              return "def factorial(n):\n    if n == 0:\n        return 1\n    return n * factorial(n-1)\n";
            }
            return "print(factorial(0))";
          },
        },
        { maxAttempts: 3 },
      );

      await loop.run({
        featureId: feature.id,
        reason: "synthetic-self-debug",
        trace: "NameError: factorial is not defined",
        parentEventId: failureEvent.id,
      });
    }
  } else {
    // For codeact / qa-review: run one cell through the interpreter so the
    // trace contains a `code.executed` event.
    try {
      cellsExecuted++;
      await interpreter.executeCell(features[0].id, "print('codeagent-smoke-ok')");
    } catch {
      // Missing python3 is fine; the demo still records structured failure events.
    }
  }

  await interpreter.shutdown();

  const saved = runtime.save();

  return {
    runtime,
    variant,
    cellsExecuted,
    interpreter,
  };
}

