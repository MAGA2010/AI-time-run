/**
 * tools/index.ts
 *
 * BREAK 7 — CodeToolSet (per CodeAgent ACL 2024):
 *   code.search, code.doc, code.symbol_nav, code.format, code.apply_patch
 *
 * Each tool conforms to the existing `Tool` interface so it plugs into
 * `Sandbox.register` and is automatically covered by BREAK 4 idempotency keys
 * and WAL preambles. `code.symbol_nav` is the highest-leverage tool per the
 * ACL 2024 ablation; `code.apply_patch` is the most security-sensitive and
 * lives under `repo.write`.
 */

import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";

import type { Tool } from "../../types.js";

function parseArgs(input: Record<string, unknown>, schema: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, kind] of Object.entries(schema)) {
    if (!(key in input)) continue;
    const value = input[key];
    if (kind === "string") out[key] = String(value);
    else if (kind === "number") out[key] = Number(value);
    else if (kind === "boolean") out[key] = Boolean(value);
    else out[key] = value;
  }
  return out;
}

// ---------------------------------------------------------------------------
// code.search — ripgrep-backed search, hard-capped at maxResults (per ACI)
// ---------------------------------------------------------------------------

export function makeSearchTool(repoRoot: string): Tool {
  return {
    name: "code.search",
    scope: "repo.read",
    description:
      "Search a pattern across the repo (ripgrep-backed). Hard-capped output forces query refinement (SWE-agent ACI).",
    run: (input) => {
      const args = parseArgs(input, { pattern: "string", glob: "string", maxResults: "number" });
      const pattern = String(args.pattern ?? "");
      const glob = args.glob as string | undefined;
      const maxResults = (args.maxResults as number | undefined) ?? 50;
      const cliArgs = ["--json", "-g", glob ?? "!*\\.lock", pattern, repoRoot];
      let out: string;
      try {
        out = execFileSync("rg", cliArgs, { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
      } catch (error) {
        const err = error as NodeJS.ErrnoException & { stderr?: Buffer };
        if (err.code === "ENOENT") return { ok: false, error: "rg-not-installed" };
        const stderr = err.stderr?.toString() ?? "";
        if (/No matches/.test(stderr)) return { matches: [], total: 0 };
        return { matches: [], error: stderr };
      }
      const lines = out.split("\n").filter(Boolean);
      const matches = lines.slice(0, maxResults).map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return { raw: l };
        }
      });
      return { matches, total: lines.length, truncated: lines.length > maxResults };
    },
    snapshot: () => ({}),
    restore: () => {},
  };
}

// ---------------------------------------------------------------------------
// code.doc — pull docstring + type signature (lightweight, language-agnostic)
// ---------------------------------------------------------------------------

export function makeDocTool(repoRoot: string): Tool {
  return {
    name: "code.doc",
    scope: "repo.read",
    description:
      "Extract docstring + signature for a given file + optional symbol (TS/Python regex).",
    run: (input) => {
      const args = parseArgs(input, { file: "string", symbol: "string" });
      const file = String(args.file ?? "");
      const symbol = args.symbol as string | undefined;
      const target = join(repoRoot, file);
      if (!existsSync(target)) return { ok: false, error: "file-not-found" };
      const content = readFileSync(target, "utf8");
      const result: { signature?: string; docstring?: string } = {};
      const lines = content.split(/\r?\n/);
      if (symbol) {
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes(symbol)) {
            result.signature = lines[i].trim();
            const doc: string[] = [];
            for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
              const line = lines[j].trim();
              if (line.startsWith("//") || line.startsWith("#") || line.startsWith('"')) {
                doc.push(line);
              } else if (doc.length > 0) {
                break;
              }
            }
            if (doc.length) result.docstring = doc.join("\n");
            break;
          }
        }
      } else {
        result.docstring = lines.slice(0, 8).join("\n");
      }
      return result;
    },
    snapshot: () => ({}),
    restore: () => {},
  };
}

// ---------------------------------------------------------------------------
// code.symbol_nav — highest-priority tool per ACL 2024 ablation.
// v1: regex-based, language-agnostic; v2: real LSP/TS-server integration.
// ---------------------------------------------------------------------------

export interface SymbolResolution {
  file: string;
  line: number;
  kind: "def" | "ref";
  snippet: string;
  symbol: string;
}

export function makeSymbolNavTool(repoRoot: string): Tool {
  return {
    name: "code.symbol_nav",
    scope: "repo.read",
    description:
      "Resolve a symbol to its definition + references. Most important tool per CodeAgent ACL 2024 ablation.",
    run: (input) => {
      const args = parseArgs(input, { symbol: "string", kind: "string" });
      const symbol = String(args.symbol ?? "");
      const kind = (args.kind as string | undefined) ?? "all";
      const cliArgs = [
        "--json",
        "-g",
        "!*.lock",
        "-g",
        "!node_modules/*",
        "-e",
        `\\b${symbol}\\b`,
        repoRoot,
      ];
      let out: string;
      try {
        out = execFileSync("rg", cliArgs, { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
      } catch (error) {
        const err = error as NodeJS.ErrnoException & { stderr?: Buffer };
        if (err.code === "ENOENT") return { ok: false, error: "rg-not-installed" };
        const stderr = err.stderr?.toString() ?? "";
        if (/No matches/.test(stderr)) return { results: [] };
        return { ok: false, error: stderr };
      }
      const results: SymbolResolution[] = [];
      for (const line of out.split("\n").filter(Boolean)) {
        try {
          const parsed = JSON.parse(line) as {
            type: string;
            data: { path: { text: string }; line_number: number; lines: { text: string } };
          };
          if (parsed.type !== "match") continue;
          const snippet = parsed.data.lines.text.trim();
          const defRe1 = new RegExp(`(function|class|const|let|var|def)\\s+${symbol}\\b`);
          const defRe2 = new RegExp(`${symbol}\\s*[:=]\\s*(function|async|\\()`);
          const looksLikeDef = defRe1.test(snippet) || defRe2.test(snippet);
          results.push({
            file: relative(repoRoot, parsed.data.path.text),
            line: parsed.data.line_number,
            kind: looksLikeDef ? "def" : "ref",
            snippet,
            symbol,
          });
        } catch {
          // skip malformed
        }
      }
      const filtered = results.filter((r) => {
        if (kind === "def") return r.kind === "def";
        if (kind === "refs") return r.kind === "ref";
        return true;
      });
      return { results: filtered.slice(0, 50), total: results.length };
    },
    snapshot: () => ({}),
    restore: () => {},
  };
}

// ---------------------------------------------------------------------------
// code.format — read-only diff (does NOT write the file)
// ---------------------------------------------------------------------------

export function makeFormatTool(
  repoRoot: string,
  formatter: "prettier" | "ruff" = "prettier",
): Tool {
  return {
    name: "code.format",
    scope: "repo.read",
    description: `Diff-only format check (${formatter}). Returns the unified diff; does NOT mutate files.`,
    run: (input) => {
      const args = parseArgs(input, { files: "string" });
      const files = (args.files as unknown as string[]) ?? [];
      if (formatter === "prettier") {
        try {
          const out = execFileSync(
            "npx",
            ["--no-install", "prettier", "--check", "--list-different", ...files],
            { cwd: repoRoot, encoding: "utf8" },
          );
          return { needsFormat: out.trim().length > 0, files: out.trim().split("\n") };
        } catch (error) {
          const err = error as { stderr?: Buffer; stdout?: Buffer };
          const stderr = err.stderr?.toString() ?? "";
          const list = err.stdout?.toString() ?? "";
          return { needsFormat: true, files: list.split("\n").filter(Boolean), stderr };
        }
      }
      return { needsFormat: false, files: [], note: "ruff-not-implemented-in-v1" };
    },
    snapshot: () => ({}),
    restore: () => {},
  };
}

// ---------------------------------------------------------------------------
// code.apply_patch — unified-diff edit (Anthropic + OpenAI v2 style).
// Atomic: any hunk failure rejects the whole patch.
// ---------------------------------------------------------------------------

export interface ParsedHunk {
  file: string;
  startLine: number;
  oldText: string;
  newText: string;
}

export function parsePatch(patch: string): {
  begin: boolean;
  end: boolean;
  hunks: ParsedHunk[];
} {
  const lines = patch.split(/\r?\n/);
  const begin = lines[0]?.trim() === "*** Begin Patch";
  const end = lines[lines.length - 1]?.trim() === "*** End Patch";
  const hunks: ParsedHunk[] = [];
  let current: Partial<ParsedHunk> | null = null;
  let oldBuf: string[] = [];
  let newBuf: string[] = [];
  let mode: "old" | "new" = "old";

  for (let i = 1; i < lines.length - 1; i++) {
    const line = lines[i];
    if (line.startsWith("*** Update File:")) {
      if (current?.file && current.startLine != null) {
        hunks.push({
          file: current.file,
          startLine: current.startLine,
          oldText: oldBuf.join("\n"),
          newText: newBuf.join("\n"),
        });
      }
      current = { file: line.slice("*** Update File:".length).trim() };
      oldBuf = [];
      newBuf = [];
      mode = "old";
      continue;
    }
    if (line.startsWith("@@")) {
      const m = /@@\s+line\s+(\d+)/.exec(line);
      if (m && current) current.startLine = Number(m[1]);
      continue;
    }
    if (!current) continue;
    if (line.startsWith("-")) {
      mode = "old";
      oldBuf.push(line.slice(1).replace(/^ /, ""));
    } else if (line.startsWith("+")) {
      mode = "new";
      newBuf.push(line.slice(1).replace(/^ /, ""));
    } else if (line.startsWith(" ")) {
      (mode === "old" ? oldBuf : newBuf).push(line.slice(1).replace(/^ /, ""));
    }
  }
  if (current?.file && current.startLine != null) {
    hunks.push({
      file: current.file,
      startLine: current.startLine,
      oldText: oldBuf.join("\n"),
      newText: newBuf.join("\n"),
    });
  }
  return { begin, end, hunks };
}

export function makeApplyPatchTool(repoRoot: string): Tool {
  return {
    name: "code.apply_patch",
    scope: "repo.write",
    description:
      "Apply a unified-diff-style patch atomically. Any hunk failure rejects the whole patch (Anthropic + OpenAI v2 semantics).",
    run: (input) => {
      const args = parseArgs(input, { patch: "string" });
      const patch = String(args.patch ?? "");
      const parsed = parsePatch(patch);
      if (!parsed.begin || !parsed.end) {
        return { ok: false, error: "missing-begin-or-end-marker" };
      }
      if (parsed.hunks.length === 0) {
        return { ok: false, error: "no-hunks" };
      }
      const backups = new Map<string, string | null>();
      for (const hunk of parsed.hunks) {
        const abs = join(repoRoot, hunk.file);
        backups.set(abs, existsSync(abs) ? readFileSync(abs, "utf8") : null);
      }
      try {
        for (const hunk of parsed.hunks) {
          const abs = join(repoRoot, hunk.file);
          const original = backups.get(abs) ?? "";
          if (!original.includes(hunk.oldText)) {
            throw new Error(`hunk-mismatch: ${hunk.file}:${hunk.startLine}`);
          }
          const replaced = original.replace(hunk.oldText, hunk.newText);
          mkdirSync(dirname(abs), { recursive: true });
          writeFileSync(abs, replaced, "utf8");
        }
        return { ok: true, filesWritten: parsed.hunks.map((h) => h.file) };
      } catch (error) {
        for (const [abs, content] of backups) {
          if (content == null) {
            try {
              rmSync(abs, { force: true });
            } catch {
              // ignore
            }
          } else {
            writeFileSync(abs, content, "utf8");
          }
        }
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          rolledBack: true,
        };
      }
    },
    snapshot: () => ({}),
    restore: () => {},
  };
}
