/**
 * self_debug.ts
 *
 * BREAK 7 — SelfDebugLoop: replaces the immediate rollback path after a
 * `failure.attributed` event with a bounded rubber-duck / CRITIC-style
 * refinement cycle. Every attempt writes claim/evidence/retry events to
 * the ledger, so a reviewer can audit what the model "said" vs what the
 * kernel actually did.
 *
 * Inspired by:
 *   - Chen et al. 2024 (Self-Debugging, ICLR 2024) — rubber-duck prompt
 *   - LDB 2024 — block-level runtime verification (we pass blame forward)
 *   - JoyCode 2025 — test-first retry with failure memory
 */

import type { Ledger } from "../ledger.js";
import { ROLES } from "../actors.js";
import type { CodeCellResult, CodeActInterpreter } from "./interpreter.js";

export interface SelfDebugOptions {
  /** Maximum retry attempts (default 3, per docs/13 §11). */
  maxAttempts?: number;
  /** Optional probe ran on each refinement output to declare pass. */
  successProbe?: (cellResult: CodeCellResult) => boolean;
}

export interface SelfDebugOutcome {
  ok: boolean;
  attempts: number;
  reason?: string;
  finalEvidenceEventId?: string;
}

export interface FailureContext {
  featureId: string;
  reason: string;
  trace: string;
  parentEventId: string;
  /** Optional block blame from upstream (e.g. LDB). */
  blockBlame?: { file: string; startLine: number; endLine: number; rule?: string }[];
  /** Optional human-friendly hint or initial refinement code. */
  hint?: string;
}

export interface SelfDebugReasoner {
  /** Produce a human-readable explanation of the last failure (rubber-duck). */
  explain(failure: FailureContext): Promise<string> | string;
  /** Produce the next refinement code given the explanation + trace. */
  refine(failure: FailureContext, explanation: string, attempt: number): Promise<string> | string;
}

export class SelfDebugLoop {
  private readonly maxAttempts: number;
  private readonly successProbe?: (cellResult: CodeCellResult) => boolean;

  constructor(
    private readonly ledger: Ledger,
    private readonly interpreter: CodeActInterpreter,
    private readonly reasoner: SelfDebugReasoner,
    options: SelfDebugOptions = {},
  ) {
    this.maxAttempts = options.maxAttempts ?? 3;
    this.successProbe = options.successProbe;
  }

  async run(failure: FailureContext): Promise<SelfDebugOutcome> {
    let lastTrace = failure.trace;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const ctx: FailureContext = { ...failure, trace: lastTrace };

      const explanation = await this.reasoner.explain(ctx);
      const refinement = await this.reasoner.refine(ctx, explanation, attempt);

      const claim = this.ledger.append({
        type: "claim.recorded",
        actor: ROLES.critic,
        payload: { scope: "sandbox.exec",
          statement: `attempt=${attempt} explanation=${truncate(explanation, 600)}`,
        },
        parent: ctx.parentEventId,
      });

      const feedback = this.ledger.append({
        type: "code.feedback",
        actor: ROLES.critic,
        payload: {
          featureId: ctx.featureId,
          attempt,
          explanation,
          prevTrace: truncate(lastTrace, 600),
        },
        parent: claim.id,
      });

      const requested = this.ledger.append({
        type: "effect.requested",
        actor: ROLES.generator,
        payload: {
          scope: "sandbox.exec",
          tool: "code.repl",
          input: { featureId: ctx.featureId, code: refinement },
          idempotencyKey: `sd:${ctx.featureId}:${attempt}`,
        },
        parent: feedback.id,
      });

      let result: CodeCellResult;
      try {
        result = await this.interpreter.executeCell(ctx.featureId, refinement);
      } catch (error) {
        result = {
          stdout: "",
          stderr: error instanceof Error ? error.message : String(error),
          returncode: -1,
          elapsedMs: 0,
        };
      }

      const actualized = this.ledger.append({
        type: "effect.actualized",
        actor: ROLES.generator,
        payload: { tool: "code.repl", output: result },
        parent: requested.id,
      });

      const evidence = this.ledger.append({
        type: "evidence.attached",
        actor: ROLES.evaluator,
        payload: {
          source: "code.cell.ok",
          kind: "trace",
          ok: result.returncode === 0,
          value: result,
        },
        parent: actualized.id,
      });

      const retry = this.ledger.append({
        type: "code.retry",
        actor: ROLES.evaluator,
        payload: {
          featureId: ctx.featureId,
          attempt,
          success: result.returncode === 0,
          blame: result.blame ?? [],
        },
        parent: evidence.id,
      });

      const passByProbe = this.successProbe ? this.successProbe(result) : true;
      if (result.returncode === 0 && passByProbe) {
        this.ledger.append({
          type: "feature.updated",
          actor: ROLES.evaluator,
          payload: {
            featureId: ctx.featureId,
            passes: true,
            evidenceEventId: evidence.id,
            via: "self-debug",
          },
          parent: retry.id,
        });
        return { ok: true, attempts: attempt, finalEvidenceEventId: evidence.id };
      }

      lastTrace = result.stderr || result.stdout || lastTrace;
    }

    return { ok: false, attempts: this.maxAttempts, reason: "max-attempts-exceeded" };
  }
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "\u2026";
}

