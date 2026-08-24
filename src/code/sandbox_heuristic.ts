/**
 * sandbox_heuristic.ts
 *
 * BREAK 7 — heuristic to detect when a tool call was *rejected by the sandbox*
 * rather than failing for a legitimate reason (per OpenAI Codex CLI
 * `is_likely_sandbox_denied`). When detected, the runtime can ask the user
 * to escalate to `DangerFullAccess` instead of failing silently.
 */

export interface CommandOutputLike {
  ok: boolean;
  error?: string;
  output?: unknown;
  stderr?: string;
  stdout?: string;
}

const SANDBOX_DENIAL_SIGNALS: readonly string[] = [
  "Operation not permitted",
  "Permission denied",
  "seatbelt",
  "Landlock",
  "bubblewrap",
  "bwrap",
  "seccomp",
  "Read-only file system",
  "not allowed by sandbox",
  "POLICY VIOLATION",
];

export function isLikelySandboxDenied(output: CommandOutputLike): boolean {
  if (output.ok) return false;
  const text = [
    typeof output.error === "string" ? output.error : "",
    typeof output.stderr === "string" ? output.stderr : "",
    typeof output.stdout === "string" ? output.stdout : "",
    safeStringify(output.output),
  ]
    .filter(Boolean)
    .join("\n");
  if (!text) return false;
  return SANDBOX_DENIAL_SIGNALS.some((signal) => text.includes(signal));
}

function safeStringify(value: unknown): string {
  try {
    if (value === undefined || value === null) return "";
    if (typeof value === "string") return value;
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

/**
 * Suggested escalation level. Returns `danger-full-access` when the
 * heuristic matches and the failure was on a tool the user probably wanted
 * to succeed; otherwise returns `keep-policy`.
 */
export function suggestedEscalation(
  output: CommandOutputLike,
  toolScope: string,
): "danger-full-access" | "keep-policy" {
  if (!isLikelySandboxDenied(output)) return "keep-policy";
  if (toolScope === "sandbox.exec" || toolScope === "repo.write" || toolScope === "fs") {
    return "danger-full-access";
  }
  return "keep-policy";
}
