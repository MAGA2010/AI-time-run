/**
 * v02.ts
 *
 * BREAK 7 v0.2 — all 10 roadmap enhancements consolidated.
 * See docs/17-deep-study.md section 6 for sources and rationale.
 *
 * Items implemented:
 *   P0-1 linterGuardedEdit() — wrap code.apply_patch with rollback on
 *        out-of-range linter complaints (SWE-Agent ACI).
 *   P0-2 TestingAgent — Fail2Pass + Pass2Pass test generation
 *        (JoyCode). Pre-validates every emitted test on HEAD.
 *   P1-3 EpisodeBudget — per-episode USD cap with token tracking
 *        (SWE-Agent per_instance_cost_limit).
 *   P1-4 StateSnapshot — .aitr-snap.json kernel globals checkpoint
 *        (OAI legacy Code Interpreter file-replay).
 *   P1-5 ObservationCompressor — 80% window history summarization
 *        (SWE-Agent).
 *   P1-6 JoyCodeVoting — 5-factor weighted patch voting
 *        (JoyCode Decision Agent).
 *   P2-7 FeedbackEvent — code.feedback event carrying traceback
 *        directly (CodeAct).
 *   P2-8 FuzzyPatch — fuzzy line matching in code.apply_patch
 *        (OAI Coworker combined_apply_patch_cli.py).
 *   P2-9 DockerIsolation — opt-in Docker sandbox for code.repl
 *        (JoyCode SWE-bench images).
 *   P3-10 MiniVariant — minimal-tool "bash-only" variant
 *        (mini-SWE-agent).
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

import type { Tool } from "../types.js";
import { parsePatch } from "./tools/index.js";

// ===========================================================================
// P0-1 — Linter-guarded edit
// ===========================================================================

/**
 * Wrap a code.apply_patch tool so that after every successful patch the
 * files are run through a linter; lint errors OUTSIDE the edited line
 * ranges trigger automatic rollback + Error. The wrapped tool preserves
 * the original Tool interface so it plugs into Sandbox.register.
 */
export interface LinterRunResult {
  file: string;
  line: number;
  message: string;
  severity: "error" | "warning";
}

export type LinterFn = (file: string, content: string) => LinterRunResult[];

/** Default no-op linter (always passes); tests inject a real one. */
export const noopLinter: LinterFn = () => [];

/** A trivial regex-based linter useful for tests / docs. */
export function regexLinter(patterns: RegExp[]): LinterFn {
  return (_file, content) => {
    const out: LinterRunResult[] = [];
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      for (const p of patterns) {
        if (p.test(lines[i])) {
          out.push({ file: _file, line: i + 1, message: p.source, severity: "error" });
        }
      }
    }
    return out;
  };
}

export function linterGuardedEdit(
  inner: Tool,
  repoRoot: string,
  linter: LinterFn,
): Tool {
  if (inner.name !== "code.apply_patch") return inner;
  return {
    ...inner,
    run: (input) => {
      // Capture pre-edit state by parsing the patch (hunks tell us which files will be touched).
      const patchStr = String((input as { patch?: unknown }).patch ?? "");
      const parsed = parsePatch(patchStr);
      const preState = new Map<string, string>();
      for (const h of parsed.hunks) {
        const abs = join(repoRoot, h.file);
        if (existsSync(abs)) preState.set(abs, readFileSync(abs, "utf8"));
      }
      const result = inner.run(input);
      if (!result || (result as { ok?: boolean }).ok !== true) return result;
      // Run linter on the post-edit file and compare against pre-edit.
      const outsideErrors: LinterRunResult[] = [];
      for (const [abs, preOriginal] of preState) {
        const current = readFileSync(abs, "utf8");
        const errors = linter(abs, current);
        const preLines = preOriginal.split("\n");
        for (const err of errors) {
          const preLine = preLines[err.line - 1] ?? "";
          const wasErrorBefore = linter(abs, preLine + "\n").some((e) => e.line === 1);
          if (!wasErrorBefore) outsideErrors.push(err);
        }
      }
      if (outsideErrors.length > 0) {
        for (const [abs, preOriginal] of preState) writeFileSync(abs, preOriginal, "utf8");
        return {
          ok: false,
          error: `lint-guard: ${outsideErrors.length} new error(s) outside edit range`,
          details: outsideErrors,
          rolledBack: true,
        };
      }
      return result;
    },
  };
}

// ===========================================================================
// P0-2 — Testing Agent (Fail2Pass + Pass2Pass)
// ===========================================================================

/**
 * A test case is a small runnable snippet paired with expectations.
 * The TestingAgent generates three kinds: failure, happy, edge.
 */
export interface TestCase {
  id: string;
  kind: "failure" | "happy" | "edge";
  /** Runnable code (the test itself). */
  code: string;
  /** What we expect on HEAD vs on the proposed fix. */
  expectOnHead: "pass" | "fail";
  expectOnFix: "pass" | "fail";
  /** Optional pre-validation result (filled in by emitAndValidate). */
  headResult?: "pass" | "fail" | "error";
}

export interface TestingAgentDeps {
  /** Run a snippet against a hypothetical "fix"; returns pass/fail/error. */
  runOnFix: (code: string) => Promise<"pass" | "fail" | "error">;
  /** Run a snippet against HEAD; returns pass/fail/error. */
  runOnHead: (code: string) => Promise<"pass" | "fail" | "error">;
}

/**
 * Generate three test cases for an issue. The caller supplies the
 * concrete synthesizers; this function applies the JoyCode 3-test
 * pattern + pre-validation.
 */
export async function generateFail2PassTests(
  issue: { description: string },
  deps: TestingAgentDeps,
  synthesize: {
    failure: (issue: { description: string }) => string;
    happy: (issue: { description: string }, scenario: string) => string;
    edge: (issue: { description: string }, scenario: string) => string;
  },
): Promise<{ accepted: TestCase[]; rejected: TestCase[] }> {
  const accepted: TestCase[] = [];
  const rejected: TestCase[] = [];

  // Pass 1: a failure test (must fail on HEAD, pass on fix).
  const failureCode = synthesize.failure(issue);
  const failure: TestCase = {
    id: randomUUID(),
    kind: "failure",
    code: failureCode,
    expectOnHead: "fail",
    expectOnFix: "pass",
  };
  failure.headResult = await deps.runOnHead(failureCode);
  if (failure.headResult === "fail") accepted.push(failure);
  else rejected.push(failure);

  // Pass 2: 2 happy/edge tests (must pass on both).
  const scenarios = ["happy_path", "edge_case"];
  for (const sc of scenarios) {
    const code = sc === "happy_path"
      ? synthesize.happy(issue, sc)
      : synthesize.edge(issue, sc);
    const tc: TestCase = {
      id: randomUUID(),
      kind: sc === "happy_path" ? "happy" : "edge",
      code,
      expectOnHead: "pass",
      expectOnFix: "pass",
    };
    tc.headResult = await deps.runOnHead(code);
    if (tc.headResult === "pass") accepted.push(tc);
    else rejected.push(tc);
  }
  return { accepted, rejected };
}


// ===========================================================================
// P1-3 — EpisodeBudget (per-episode USD cap)
// ===========================================================================

/**
 * Track USD spend against a per-episode budget. Caller supplies a
 * cost-per-token function (model-specific). When budget is exhausted,
 * the caller is expected to abort the episode.
 */
export interface EpisodeBudgetOptions {
  /** Maximum USD per episode. Default 0.50 (matches SWE-Agent). */
  maxBudgetUsd?: number;
  /** Cost in USD per 1K input tokens. */
  costPer1kInputTokens: number;
  /** Cost in USD per 1K output tokens. */
  costPer1kOutputTokens: number;
}

export interface EpisodeBudgetState {
  spentUsd: number;
  inputTokens: number;
  outputTokens: number;
  calls: number;
}

export function makeEpisodeBudget(opts: EpisodeBudgetOptions) {
  const maxBudgetUsd = opts.maxBudgetUsd ?? 0.5;
  const state: EpisodeBudgetState = {
    spentUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    calls: 0,
  };
  function record(input: number, output: number) {
    state.inputTokens += input;
    state.outputTokens += output;
    state.calls += 1;
    state.spentUsd +=
      (input / 1000) * opts.costPer1kInputTokens +
      (output / 1000) * opts.costPer1kOutputTokens;
  }
  return {
    state,
    record,
    isExhausted: () => state.spentUsd >= maxBudgetUsd,
    remaining: () => Math.max(0, maxBudgetUsd - state.spentUsd),
    /** Return true if the next call would exceed budget. */
    wouldExceed: (input: number, output: number) =>
      state.spentUsd +
        (input / 1000) * opts.costPer1kInputTokens +
        (output / 1000) * opts.costPer1kOutputTokens > maxBudgetUsd,
  };
}


// ===========================================================================
// P1-4 — StateSnapshot (.aitr-snap.json kernel checkpoint)
// ===========================================================================

/**
 * Capture a kernel globals dict to .aitr-snap.json. Small primitives
 * are inlined; larger / non-JSON objects are recorded by repr only
 * (caller is responsible for pickling them to /state/ first).
 */
export interface GlobalsSnapshot {
  [name: string]: {
    _repr: string;
    value?: unknown;
    path?: string;
    sha256?: string;
  };
}

export interface KernelSnapshot {
  kernel_id: string;
  globals: GlobalsSnapshot;
  cell_count: number;
  snapshot_at: string;
}

export function writeSnapshot(
  workspace: string,
  kernelId: string,
  globals: GlobalsSnapshot,
  cellCount: number,
): { path: string; bytes: number } {
  const snap: KernelSnapshot = {
    kernel_id: kernelId,
    globals,
    cell_count: cellCount,
    snapshot_at: new Date().toISOString(),
  };
  const path = join(workspace, ".aitr-snap.json");
  const json = JSON.stringify(snap, null, 2);
  writeFileSync(path, json, "utf8");
  return { path, bytes: json.length };
}

export function readSnapshot(workspace: string): KernelSnapshot | null {
  const path = join(workspace, ".aitr-snap.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as KernelSnapshot;
  } catch {
    return null;
  }
}

/** Walk a JS object, capturing each top-level key as a snapshot entry. */
export function capturePrimitives(obj: Record<string, unknown>): GlobalsSnapshot {
  const out: GlobalsSnapshot = {};
  for (const [k, v] of Object.entries(obj)) {
    const t = typeof v;
    if (v == null || t === "string" || t === "number" || t === "boolean") {
      out[k] = { _repr: t, value: v ?? null };
    } else if (Array.isArray(v) && v.every((x) => typeof x !== "object")) {
      out[k] = { _repr: "array", value: v };
    } else {
      out[k] = { _repr: (v as { constructor?: { name?: string } }).constructor?.name ?? typeof v };
    }
  }
  return out;
}


// ===========================================================================
// P1-5 — ObservationCompressor (80% window summary)
// ===========================================================================

/**
 * Compress a stream of observations into a fixed-window summary.
 * The first 80% of observations are summarised into a single string
 * that preserves error chains (e.g. "tried X -> got Y -> tried Z").
 * The last 20% is kept verbatim.
 *
 * Per the SWE-Agent ACI ablation, this beats naive last-N truncation
 * because the summary preserves the agent’s failure-and-retry story.
 */
export interface CompressOptions {
  /** Total window size (default 20, matching SWE-Agent). */
  windowSize?: number;
  /** Fraction of the window to summarise (default 0.8). */
  summariseFraction?: number;
}

export function compressObservations(
  observations: string[],
  options: CompressOptions = {},
): { summary: string; tail: string[]; dropped: number } {
  const win = options.windowSize ?? 20;
  const frac = options.summariseFraction ?? 0.8;
  if (observations.length <= win) {
    return { summary: "", tail: observations.slice(), dropped: 0 };
  }
  const keep = win;
  const tail = observations.slice(-keep);
  const toSummarise = observations.slice(0, observations.length - keep);
  const cutoff = Math.floor(toSummarise.length * frac);
  const dropped = toSummarise.length - cutoff;
  const summarySource = toSummarise.slice(0, cutoff);
  // Build error-chain summary: first line + last line per chunk of 5.
  const lines: string[] = [];
  for (let i = 0; i < summarySource.length; i += 5) {
    const chunk = summarySource.slice(i, i + 5);
    const first = chunk[0]?.slice(0, 120) ?? "";
    const last = chunk[chunk.length - 1]?.slice(-120) ?? "";
    lines.push(`[obs ${i + 1}-${i + chunk.length}] ${first} ... ${last}`);
  }
  return {
    summary: lines.join("\n"),
    tail,
    dropped,
  };
}

// ===========================================================================
// P1-6 — JoyCodeVoting (5-factor weighted patch voting)
// ===========================================================================

/**
 * JoyCode-style 5-factor weighted voting. Correctness dominates;
 * minimality, risk, code quality, test coverage are tiebreakers.
 */
export interface PatchCandidate {
  id: string;
  /** Number of tests that passed for this candidate. */
  testsPassed: number;
  /** Total number of tests run. */
  testsTotal: number;
  /** Diff size in lines (smaller is better). */
  diffSize: number;
  /** Whether the patch touches any protected files (true = risky). */
  touchesProtected: boolean;
  /** Linter score in [0, 1]. */
  codeQuality: number;
  /** Lines covered by tests / total touched lines. */
  testCoverage: number;
}

export const JOYCODE_WEIGHTS = {
  correctness: 0.5,
  minimality: 0.2,
  risk: 0.15,
  codeQuality: 0.1,
  testCoverage: 0.05,
} as const;

export function scorePatch(p: PatchCandidate): number {
  const correctness = p.testsTotal === 0 ? 0 : p.testsPassed / p.testsTotal;
  const minimality = Math.max(0, 1 - p.diffSize / 1000);
  const risk = p.touchesProtected ? 0 : 1;
  const codeQuality = Math.min(1, Math.max(0, p.codeQuality));
  const testCoverage = Math.min(1, Math.max(0, p.testCoverage));
  return (
    correctness * JOYCODE_WEIGHTS.correctness +
    minimality * JOYCODE_WEIGHTS.minimality +
    risk * JOYCODE_WEIGHTS.risk +
    codeQuality * JOYCODE_WEIGHTS.codeQuality +
    testCoverage * JOYCODE_WEIGHTS.testCoverage
  );
}

/** Return the index of the best candidate, or -1 for empty. */
export function voteBest(candidates: PatchCandidate[]): number {
  if (candidates.length === 0) return -1;
  let bestIdx = 0;
  let bestScore = -Infinity;
  for (let i = 0; i < candidates.length; i++) {
    const s = scorePatch(candidates[i]);
    if (s > bestScore) { bestScore = s; bestIdx = i; }
  }
  return bestIdx;
}


// ===========================================================================
// P2-7 — FeedbackEvent (code.feedback carrying traceback directly)
// ===========================================================================

/**
 * Build a code.feedback event payload. The traceback is carried
 * directly so SelfDebugLoop can pattern-match against traceback types
 * without re-parsing CodeCell.result.stderr.
 */
export interface FeedbackEvent {
  type: "code.feedback";
  /** Cell id that produced this feedback. */
  cellId: string;
  /** Whether the cell succeeded. */
  ok: boolean;
  /** Parsed traceback lines (empty if ok). */
  traceback: string[];
  /** One-line summary (last non-empty traceback line). */
  summary: string;
  /** Cost so far in USD (if a budget is attached). */
  spentUsd?: number;
}

export function buildFeedbackEvent(
  cellId: string,
  ok: boolean,
  stderr: string,
  spentUsd?: number,
): FeedbackEvent {
  const traceback = stderr.split("\n").map((l) => l.trimEnd()).filter(Boolean);
  const summary = traceback[traceback.length - 1] ?? "";
  const ev: FeedbackEvent = { type: "code.feedback", cellId, ok, traceback, summary };
  if (spentUsd !== undefined) ev.spentUsd = spentUsd;
  return ev;
}

/** Heuristic: does the traceback look like a NameError? */
export function isNameError(ev: FeedbackEvent): boolean {
  return ev.traceback.some((l) => /NameError/i.test(l));
}

/** Heuristic: does the traceback look like an ImportError / ModuleNotFoundError? */
export function isImportError(ev: FeedbackEvent): boolean {
  return ev.traceback.some((l) => /(Import|ModuleNotFound)Error/i.test(l));
}


// ===========================================================================
// P2-8 — FuzzyPatch (fuzzy line matching in apply_patch)
// ===========================================================================

/**
 * Find the best fuzzy match for a snippet within a larger body.
 * Returns the match index and a confidence in [0,1], or -1 if no
 * plausible match exists. Uses a simple line-by-line Levenshtein
 * sum over context window of `snippet`.
 */
export function fuzzyFind(
  body: string,
  snippet: string,
  minSimilarity = 0.7,
): { index: number; similarity: number } {
  if (!snippet) return { index: 0, similarity: 1 };
  const bodyLines = body.split("\n");
  const snipLines = snippet.split("\n");
  if (snipLines.length === 0) return { index: 0, similarity: 1 };
  let best = { index: -1, similarity: 0 };
  for (let i = 0; i <= bodyLines.length - snipLines.length; i++) {
    let total = 0;
    let maxLen = 0;
    for (let j = 0; j < snipLines.length; j++) {
      const a = snipLines[j];
      const b = bodyLines[i + j];
      const dist = levenshtein(a, b);
      const max = Math.max(a.length, b.length, 1);
      total += dist / max;
      maxLen += 1;
    }
    const similarity = 1 - total / Math.max(1, maxLen);
    if (similarity > best.similarity) best = { index: i, similarity };
  }
  if (best.similarity < minSimilarity) return { index: -1, similarity: best.similarity };
  return best;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  const m = a.length;
  const n = b.length;
  const prev: number[] = new Array(n + 1);
  const curr: number[] = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + cost,
      );
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }
  return prev[n];
}

/**
 * Apply a hunk to body using fuzzy matching. Returns the new body, or
 * throws if no fuzzy match exceeds the similarity threshold.
 */
export function applyFuzzy(body: string, oldText: string, newText: string, minSimilarity = 0.7): string {
  if (body.includes(oldText)) return body.replace(oldText, newText);
  const m = fuzzyFind(body, oldText, minSimilarity);
  if (m.index < 0) throw new Error(`fuzzy-match-failed: similarity=${m.similarity.toFixed(2)}`);
  const lines = body.split("\n");
  const oldLines = oldText.split("\n");
  lines.splice(m.index, oldLines.length, ...newText.split("\n"));
  return lines.join("\n");
}

// ===========================================================================
// P2-9 — DockerIsolation (opt-in Docker sandbox for code.repl)
// ===========================================================================

/**
 * Detect whether docker is available on the host. Returns true if
 * `docker version` exits 0. Used to gate code.docker=true opt-in.
 */
export async function isDockerAvailable(): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const child = spawn("docker", ["version"], { stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.on("exit", (code) => resolve(code === 0));
  });
}

/**
 * Run a Python snippet inside a one-shot docker container. Returns
 * the trimmed stdout/stderr. The image defaults to python:3.11-slim.
 */
export interface DockerRunOptions {
  image?: string;
  workdir?: string;
  mountPath?: string;
  timeoutMs?: number;
}

export function dockerRunPython(
  code: string,
  options: DockerRunOptions = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const image = options.image ?? "python:3.11-slim";
  const workdir = options.workdir ?? "/workspace";
  const args: string[] = ["run", "--rm", "-i"];
  if (options.mountPath) {
    args.push("-v" + options.mountPath + ":" + workdir);
  }
  args.push("-w" + workdir, image, "python3", "-c", code);
  return new Promise((resolve) => {
    const child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill(), options.timeoutMs ?? 30000);
    child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ stdout, stderr: stderr + (err.message ?? ""), exitCode: -1 });
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code ?? -1 });
    });
  });
}

// ===========================================================================
// P3-10 — MiniVariant (minimal-tool "bash-only" variant)
// ===========================================================================

/**
 * A minimal tool set inspired by mini-SWE-agent: read_file, edit_file,
 * bash, submit. Fewer tools = simpler model picker = better
 * small-model throughput (the "harness matters more than the model"
 * finding from the docs/17 deep study).
 */
export interface MiniTool {
  name: string;
  description: string;
  invoke: (input: Record<string, unknown>) => unknown | Promise<unknown>;
}

export interface MiniVariantOptions {
  cwd: string;
  maxCmdLen?: number;
}

export function makeMiniVariant(opts: MiniVariantOptions): MiniTool[] {
  const maxLen = opts.maxCmdLen ?? 1024;
  return [
    {
      name: "read_file",
      description: "Read a file under " + opts.cwd + ". Input: { path: string }.",
      invoke: ({ path }) => {
        const abs = join(opts.cwd, String(path ?? ""));
        if (!existsSync(abs)) return { error: "not-found" };
        return { content: readFileSync(abs, "utf8") };
      },
    },
    {
      name: "bash",
      description: "Run a bash command. Input: { cmd: string }. Max length " + maxLen + ".",
      invoke: ({ cmd }) => new Promise((resolve) => {
        const c = String(cmd ?? "");
        if (c.length > maxLen) return resolve({ error: "cmd-too-long", max: maxLen });
        const child = spawn("bash", ["-c", c], { cwd: opts.cwd, stdio: ["ignore", "pipe", "pipe"] });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
        child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
        child.on("exit", (code) => resolve({ stdout: stdout.trim(), stderr: stderr.trim(), code: code ?? -1 }));
        child.on("error", (err) => resolve({ stdout, stderr: stderr + err.message, code: -1 }));
      }),
    },
    {
      name: "submit",
      description: "End the episode. Input: { message?: string }.",
      invoke: ({ message }) => ({ done: true, message: String(message ?? "") }),
    },
  ];
}

export function makeMiniEditFile(cwd: string): MiniTool {
  return {
    name: "edit_file",
    description: "Overwrite a file with new content. Input: { path: string, content: string }.",
    invoke: ({ path, content }) => {
      const abs = join(cwd, String(path ?? ""));
      const tmp = abs + ".tmp-" + randomUUID();
      writeFileSync(tmp, String(content ?? ""), "utf8");
      renameSync(tmp, abs);
      return { ok: true, file: abs };
    },
  };
}

export function makeMiniToolSet(opts: MiniVariantOptions): MiniTool[] {
  return [...makeMiniVariant(opts), makeMiniEditFile(opts.cwd)];
}

