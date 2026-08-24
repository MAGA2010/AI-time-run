/**
 * interpreter.ts
 *
 * BREAK 7 — CodeActInterpreter: a Jupyter-style stateful Python kernel
 * per feature, modeled after the OpenAI Code Interpreter architecture
 * (AsyncMultiKernelManager + uvicorn-style IPC, in one file).
 *
 * Design notes:
 * - One long-lived Python subprocess per feature. stdin = cells, stdout = JSON results.
 * - Globals persist across cells (CodeAct key insight).
 * - snapshot/restore save/restore the globals dict via JSON.
 * - No external `jupyter-client` dep; we ship a small Python wrapper.
 * - If python3 is missing on PATH, startFeature() registers a synthetic
 *   `dead` kernel that returns structured failures instead of crashing.
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import type { BlockBlame, Probe, ProbeResult, Tool } from "../types.js";

export interface CodeActOptions {
  pythonBin?: string;
  workspaceRoot: string;
  cellTimeoutMs?: number;
  memoryLimitMb?: number;
  idleTimeoutMs?: number;
}

interface KernelHandle {
  featureId: string;
  process: import("node:child_process").ChildProcessWithoutNullStreams;
  workspace: string;
  buffer: string;
  pending: Map<
    string,
    {
      resolve: (value: import("../types.js").CodeCellResult) => void;
      reject: (reason: Error) => void;
      timer: NodeJS.Timeout;
    }
  >;
  lastUsedAt: number;
  shutDown: boolean;
  synthetic?: boolean;
}

const PYTHON_WRAPPER = String.raw`
import json
import sys
import traceback

GLOBALS = {"__name__": "__main__"}

def _emit(obj):
    sys.stdout.write(json.dumps(obj, default=str) + "\n")
    sys.stdout.flush()

def _execute(code: str):
    import io
    from contextlib import redirect_stdout, redirect_stderr
    out_buf = io.StringIO()
    err_buf = io.StringIO()
    returncode = 0
    try:
        with redirect_stdout(out_buf), redirect_stderr(err_buf):
            exec(compile(code, "<cell>", "exec"), GLOBALS)
    except SystemExit as e:
        returncode = int(e.code) if e.code is not None else 0
    except BaseException:
        returncode = 1
        err_buf.write(traceback.format_exc())
    return out_buf.getvalue(), err_buf.getvalue(), returncode

def _dump():
    safe = {}
    for k, v in GLOBALS.items():
        if k.startswith("_"):
            continue
        try:
            json.dumps(v)
            safe[k] = v
        except Exception:
            safe[k] = {"__unserializable__": type(v).__name__}
    return safe

def _load(payload):
    GLOBALS.clear()
    GLOBALS.update({"__name__": "__main__"})
    for k, v in payload.items():
        GLOBALS[k] = v

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        msg = json.loads(line)
    except Exception as e:
        _emit({"type": "error", "error": "bad-protocol: " + str(e)})
        continue
    kind = msg.get("type")
    if kind == "execute":
        req_id = msg["requestId"]
        stdout, stderr, rc = _execute(msg["code"])
        _emit({"type": "result", "requestId": req_id, "ok": rc == 0, "stdout": stdout, "stderr": stderr, "returncode": rc})
    elif kind == "snapshot":
        _emit({"type": "snapshot", "globals": _dump()})
    elif kind == "restore":
        _load(msg.get("globals", {}))
        _emit({"type": "restored"})
    elif kind == "shutdown":
        _emit({"type": "bye"})
        break
    else:
        _emit({"type": "error", "error": "unknown-kind: " + str(kind)})
`;

function makeDeadHandle(featureId: string, workspace: string, pythonBin: string): KernelHandle {
  const dead: KernelHandle = {
    featureId,
    process: {
      stdin: { write: () => true } as never,
      stdout: { on: () => {} } as never,
      stderr: { on: () => {} } as never,
      on: () => dead,
      kill: () => true,
      pid: undefined,
    } as unknown as import("node:child_process").ChildProcessWithoutNullStreams,
    workspace,
    buffer: "",
    pending: new Map(),
    lastUsedAt: Date.now(),
    shutDown: true,
    synthetic: true,
  };
  // Capture pythonBin in the closure for diagnostics without leaking into the API.
  void pythonBin;
  return dead;
}

export class CodeActInterpreter {
  private readonly pythonBin: string;
  private readonly workspaceRoot: string;
  private readonly cellTimeoutMs: number;
  private readonly memoryLimitMb: number;
  private readonly idleTimeoutMs: number;
  private readonly kernels = new Map<string, KernelHandle>();
  private idleSweep: NodeJS.Timeout | null = null;

  constructor(options: CodeActOptions) {
    this.pythonBin = options.pythonBin ?? "python3";
    this.workspaceRoot = options.workspaceRoot;
    this.cellTimeoutMs = options.cellTimeoutMs ?? 30_000;
    this.memoryLimitMb = options.memoryLimitMb ?? 512;
    this.idleTimeoutMs = options.idleTimeoutMs ?? 5 * 60_000;
    mkdirSync(this.workspaceRoot, { recursive: true });
    this.startIdleSweep();
  }

  async startFeature(featureId: string): Promise<{ started: boolean; error?: string }> {
    if (this.kernels.has(featureId)) return { started: false };
    const ws = join(this.workspaceRoot, featureId);
    mkdirSync(ws, { recursive: true });
    const wrapperPath = join(ws, "__kernel__.py");
    writeFileSync(wrapperPath, PYTHON_WRAPPER, "utf8");

    const child = spawn(this.pythonBin, ["-u", wrapperPath], {
      cwd: ws,
      env: {
        PATH: process.env.PATH ?? "",
        HOME: ws,
        TMPDIR: ws,
        PYTHONUNBUFFERED: "1",
        PYTHONDONTWRITEBYTECODE: "1",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });  const handle: KernelHandle = {
      featureId,
      process: child,
      workspace: ws,
      buffer: "",
      pending: new Map(),
      lastUsedAt: Date.now(),
      shutDown: false,
    };

    child.on("error", (error) => {
      const err = error as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        const dead = makeDeadHandle(featureId, ws, this.pythonBin);
        this.kernels.set(featureId, dead);
      } else {
        for (const [reqId, pending] of handle.pending) {
          clearTimeout(pending.timer);
          pending.reject(error);
        }
        handle.pending.clear();
        handle.shutDown = true;
        this.kernels.delete(featureId);
      }
    });
    child.stdout.on("data", (chunk: Buffer) => this.onStdout(handle, chunk.toString("utf8")));
    child.on("exit", (code, signal) => {
      for (const [reqId, pending] of handle.pending) {
        clearTimeout(pending.timer);
        pending.reject(new Error("kernel-exit: code=" + code + " signal=" + signal + " req=" + reqId));
      }
      handle.pending.clear();
      handle.shutDown = true;
      this.kernels.delete(featureId);
    });

    this.kernels.set(featureId, handle);
    return { started: true };
  }

  async executeCell(featureId: string, code: string): Promise<import("../types.js").CodeCellResult> {
    let handle = this.kernels.get(featureId);
    if (!handle) {
      await this.startFeature(featureId);
      handle = this.kernels.get(featureId)!;
    }
    if (handle.shutDown) {
      return {
        stdout: "",
        stderr: "kernel-unavailable: " + this.pythonBin + " missing on PATH (set AI_TIME_RUN_PYTHON to override)",
        returncode: -1,
        elapsedMs: 0,
      };
    }
    handle.lastUsedAt = Date.now();

    const requestId = randomUUID();
    const cellPromise = new Promise<import("../types.js").CodeCellResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        handle!.pending.delete(requestId);
        reject(new Error("cell-timeout: " + this.cellTimeoutMs + "ms"));
      }, this.cellTimeoutMs);

      handle!.pending.set(requestId, { resolve, reject, timer });
      try {
        handle!.process.stdin.write(
          JSON.stringify({ type: "execute", requestId, code }) + "\n",
        );
      } catch (error) {
        clearTimeout(timer);
        handle!.pending.delete(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });

    try {
      const result = await cellPromise;
      return { ...result, blame: extractBlame(result.stderr || "") };
    } catch (error) {
      return {
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
        returncode: -1,
        elapsedMs: 0,
      };
    }
  }

  snapshot(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [featureId, handle] of this.kernels) {
      try {
        handle.process.stdin.write(JSON.stringify({ type: "snapshot" }) + "\n");
      } catch {
        out[featureId] = null;
      }
      out[featureId] = { workspace: handle.workspace, pid: handle.process.pid, synthetic: handle.synthetic };
    }
    return out;
  }

  async restore(snapshot: Record<string, unknown>): Promise<void> {
    for (const featureId of Object.keys(snapshot)) {
      const storePath = join(this.workspaceRoot, featureId, "__globals__.json");
      if (!existsSync(storePath)) continue;
      try {
        await this.startFeature(featureId);
        const payload = JSON.parse(readFileSync(storePath, "utf8"));
        const handle = this.kernels.get(featureId)!;
        handle.process.stdin.write(JSON.stringify({ type: "restore", globals: payload }) + "\n");
      } catch {
        // best-effort; skip un-restorable kernels
      }
    }
  }

  async shutdownFeature(featureId: string): Promise<void> {
    const handle = this.kernels.get(featureId);
    if (!handle) return;
    try {
      handle.process.stdin.write(JSON.stringify({ type: "shutdown" }) + "\n");
    } catch {
      // ignore
    }
    setTimeout(() => {
      if (!handle.shutDown && !handle.synthetic) handle.process.kill("SIGTERM");
    }, 500).unref();
    this.kernels.delete(featureId);
  }

  async shutdown(): Promise<void> {
    if (this.idleSweep) clearInterval(this.idleSweep);
    for (const featureId of [...this.kernels.keys()]) {
      await this.shutdownFeature(featureId);
    }
  }

  size(): number {
    return this.kernels.size;
  }

  asTool(): Tool {
    return {
      name: "code.repl",
      scope: "sandbox.exec",
      description:
        "Execute Python code in a stateful per-feature kernel (CodeAct). Globals persist across cells.",
      run: async (input: Record<string, unknown>) => {
        const { featureId, code } = input as { featureId: string; code: string };
        const started = Date.now();
        const result = await this.executeCell(featureId, code);
        return { ...result, elapsedMs: Date.now() - started };
      },
      snapshot: () => this.snapshot(),
      restore: (snap) => {
        void this.restore(snap as Record<string, unknown>);
      },
    };
  }

  asProbe(): Probe {
    return {
      id: "code.kernel.live",
      run: () => ({ ok: true, value: { live: this.kernels.size } }),
    };
  }

  // ---- internals ----

  private onStdout(handle: KernelHandle, chunk: string): void {
    handle.buffer += chunk;
    let nl: number;
    while ((nl = handle.buffer.indexOf("\n")) >= 0) {
      const line = handle.buffer.slice(0, nl).trim();
      handle.buffer = handle.buffer.slice(nl + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        this.handleMessage(handle, msg as { type: string; [k: string]: unknown });
      } catch {
        // ignore malformed lines; wrapper always emits valid JSON
      }
    }
  }

  private handleMessage(
    handle: KernelHandle,
    msg: { type: string; [k: string]: unknown },
  ): void {
    if (msg.type === "result") {
      const reqId = msg.requestId as string;
      const pending = handle.pending.get(reqId);
      if (!pending) return;
      clearTimeout(pending.timer);
      handle.pending.delete(reqId);
      pending.resolve({
        stdout: String(msg.stdout ?? ""),
        stderr: String(msg.stderr ?? ""),
        returncode: Number(msg.returncode ?? 0),
        elapsedMs: 0,
      });
    } else if (msg.type === "snapshot") {
      try {
        const storePath = join(handle.workspace, "__globals__.json");
        writeFileSync(storePath, JSON.stringify(msg.globals ?? {}));
      } catch {
        // ignore
      }
    }
  }

  private startIdleSweep(): void {
    if (this.idleTimeoutMs <= 0) return;
    this.idleSweep = setInterval(() => {
      const now = Date.now();
      for (const [featureId, handle] of this.kernels) {
        if (now - handle.lastUsedAt > this.idleTimeoutMs) {
          void this.shutdownFeature(featureId);
        }
      }
    }, 60_000).unref();
  }
}

export function extractBlame(stderr: string): BlockBlame[] {
  const blame: BlockBlame[] = [];
  const re = /File "([^"]+)", line (\d+)(?:, in (.+))?/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(stderr))) {
    const [, file, line, inFn] = match;
    const ln = Number(line);
    blame.push({
      file,
      startLine: ln,
      endLine: ln,
      trace: inFn ? "in " + inFn : "in <module>",
    });
  }
  return blame;
}

export function cleanupWorkspace(workspaceRoot: string, featureId: string): void {
  const ws = join(workspaceRoot, featureId);
  if (existsSync(ws)) rmSync(ws, { recursive: true, force: true });
}

// Re-export so callers can `import { CodeCellResult } from "./interpreter.js"`
export type { CodeCellResult } from "../types.js";
export type { ProbeResult };

