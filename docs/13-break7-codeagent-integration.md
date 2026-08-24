# BREAK 7 — CodeAgent Integration

> 设计稿：在 ai-time-run v0.1.0 基础上融合 CodeAgent 能力。
> 输入：docs/14-codeagent-study-notes.md（学习笔记）。
> 目标：把 CodeAgent 家族 + OpenAI 的成熟做法（Code Interpreter / Codex CLI / Codex Cloud / Responses API / Agents SDK v2）落到现有 9 模块 MDIBUS V18 架构上，**不引入第三方 sandbox**，继续走 event-sourced ledger。

---

## 1. 目标与非目标

### 1.1 目标

1. 让 ai-time-run 能开箱即用做 **repo-level 软件工程**（SWE-bench / HumanEvalFix 这类）
2. 保留六大非协商原则 + 新增两条 CodeAgent 专属原则
3. **不破坏**现有 demo / BREAK 1-6 行为——所有新增向后兼容
4. 用 BREAK 7 作为后续 v0.2 release 的旗舰能力

### 1.2 非目标

- 不引入 E2B / Daytona / Blaxel / Cloudflare / Modal 等第三方 sandbox——ai-time-run 是 local-first
- 不支持 server-managed container——sandbox 仍是 process-local
- 不替换 `Reasoner` 接口——brain 仍是 swappable，但新增 3 个 CodeAgent 专属 Reasoner 模板
- 不实现多 LLM 并行仲裁 v1 版——`SelectorReasoner` 留接口位，第一版只实现单 LLM 投票

---

## 2. 设计原则（保留 6 条，新增 2 条）

### 2.1 保留原 6 条（出自 README）

1. **Evidence before pass.** 任何 feature 必须有 `ok:true` 证据才能 flips `passes: true`
2. **Authority is data.** Grants 是事件，revocation 是 tombstone
3. **Every step is traceable.** Ledger 是 append-only + replayable
4. **The brain is swappable.** Reasoner 是唯一 model-facing seam
5. **Failures are attributed, then recovered.** failure.attributed 必须先于 rollback
6. **The hands are isolated.** Tool crashes 永远不到达 brain；effect 先 checkpoint 后执行

### 2.2 新增 2 条

7. **Python as first-class action.** `code.repl` 是一个 tool，不是 brain；CodeAct 风格的 Python code 是允许的动作表示（学自 CodeAct + OpenAI Code Interpreter）
8. **Test-first, then patch.** probe 在 candidate 前生成；block-level verification 是默认；self-debug 是 failure path 的中间环节，不是终态（学自 JoyCode + LDB + Self-Debugging）

---

## 3. 架构映射（MDIBUS V18 × CodeAgent）

| MDIBUS 模块 | CodeAgent 对位 | BREAK 7 增量 |
| --- | --- | --- |
| **01 Principal + Mission** | Mission manifest | `Mission.manifest` 字段（mounts / env / ports / deps / ephemeral） |
| **02 Cognitive Services** | Pseudo-code plan + multi-agent | `PseudoCodeStep[]` + `QAReasoner` + `SelectorReasoner` |
| **03 MDIBUS Kernel** | CodeAct events | 5 个新 EventType（`code.executed` / `code.feedback` / `code.retry` / `code.symbol_resolved` / `code.apply_patch` / `code.escalate` / `code.plan_recorded`） |
| **04 Actor Kernel** | QA-Checker lane | `actor: 'qa-checker'` / `actor: 'code-reviewer'` actor role |
| **05 Capability + Session** | SandboxPolicy enum | `SandboxPolicy` 默认改为 `WorkspaceWrite + on-request`，high-impact scope 升级人工 |
| **06 Environments / World** | CodeActInterpreter + 5 Tools | `src/code/interpreter.ts` + `src/code/tools/*.ts` |
| **07 Effect + Verification** | Block-level runtime + Test-First | `ProbeResult.block_blame` + `SelfDebugLoop` 替换 immediate rollback |
| **08 Workspace + Memory** | Code-Feedback memory + Lakeview | `CodeTraceMemory` + `EpisodicMemory.async_summarize()` |
| **09 Eval + Oversight** | Sandbox deny heuristic | `isLikelySandboxDenied()` + `SandboxEscalate` 事件 |

---

## 4. 4 个增量组件

### 4.1 `src/code/interpreter.ts` — CodeActInterpreter

**形态**：与 `FileSystemAdapter` 平级的 Environment adapter，挂在 `Sandbox.tools` 下，scope 为 `sandbox.exec`。

**实现要点**：

```ts
import { spawn, ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';

import type { Probe, ProbeResult, Tool } from './types.js';

export interface InterpreterOptions {
  /** Path to a Python with jupyter_client installed. */
  pythonBin: string;
  /** Root directory for the kernel working area. */
  workspaceRoot: string;
  /** Max execution time per cell (ms). */
  cellTimeoutMs?: number;
  /** Max total memory per kernel (MB). */
  memoryLimitMb?: number;
}

/**
 * CodeActInterpreter: a Jupyter Kernel-backed Tool that executes Python
 * code with stateful variables, mirrors the OpenAI Code Interpreter
 * architecture (tini + AsyncMultiKernelManager in one file).
 */
export class CodeActInterpreter {
  private kernels = new Map<string, ChildProcess>();   // featureId -> kernel
  private workspaces = new Map<string, string>();     // featureId -> workspace dir
  private options: Required<InterpreterOptions>;

  constructor(options: InterpreterOptions) {
    this.options = {
      cellTimeoutMs: 30_000,
      memoryLimitMb: 512,
      ...options,
    };
  }

  async startFeature(featureId: string): Promise<void> {
    const ws = join(this.options.workspaceRoot, featureId);
    mkdirSync(ws, { recursive: true });
    this.workspaces.set(featureId, ws);

    // Spawn: python -m ipykernel_launcher --kernel-id <featureId>
    const child = spawn(
      this.options.pythonBin,
      ['-m', 'ipykernel_launcher', '--kernel-id', featureId],
      {
        cwd: ws,
        env: {
          // Scrubbed env (Codex CLI-style: rebuild PATH, redirect HOME)
          PATH: '/usr/local/bin:/usr/bin:/bin',
          HOME: ws,
          TMPDIR: ws,
          PYTHONUNBUFFERED: '1',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );

    this.kernels.set(featureId, child);
  }

  async executeCell(featureId: string, code: string): Promise<ProbeResult> {
    const kernel = this.kernels.get(featureId);
    if (!kernel) return { ok: false, value: null, detail: 'no-kernel' };

    // Send via Jupyter wire protocol over stdin/stdout; simplified
    const requestId = randomUUID();
    kernel.stdin?.write(JSON.stringify({ requestId, code }) + '\n');

    // Wait for response with cellTimeoutMs budget
    const start = Date.now();
    // ... read stdout, parse response (Jupyter IOPub / shell channels) ...
    // (full implementation in interpreter.ts uses jupyter-client npm pkg)

    return { ok: true, value: { stdout, stderr, returncode, elapsedMs }, detail };
  }

  async shutdownFeature(featureId: string): Promise<void> {
    const kernel = this.kernels.get(featureId);
    if (!kernel) return;
    kernel.kill('SIGTERM');
    this.kernels.delete(featureId);
    // workspace dir is cleaned by Episode cleanup; not here
  }

  /** Tool surface: register with Sandbox as a `code.repl` tool. */
  asTool(): Tool {
    return {
      name: 'code.repl',
      scope: 'sandbox.exec',
      description: 'Execute Python code in a stateful Jupyter Kernel (CodeAct).',
      run: async (input: Record<string, unknown>) => {
        const { featureId, code } = input as { featureId: string; code: string };
        return this.executeCell(featureId, code);
      },
      snapshot: () => {
        // Save current kernel state to disk via %store magic; return map
        const result: Record<string, unknown> = {};
        for (const [featureId, ws] of this.workspaces) {
          const store = join(ws, '__store__.json');
          result[featureId] = existsSync(store) ? readFileSync(store, 'utf8') : null;
        }
        return result;
      },
      restore: (snap: unknown) => {
        // Restore kernel variables from snapshot via %store -r
        const map = snap as Record<string, string | null>;
        for (const [featureId, content] of Object.entries(map)) {
          if (content) writeFileSync(join(this.workspaces.get(featureId)!, '__store__.json'), content);
        }
      },
    };
  }

  /** Probe surface: `code.cell.ok` returns last cell exit code. */
  asProbe(): Probe {
    return {
      id: 'code.cell.ok',
      run: () => ({ ok: true, value: { healthy: this.kernels.size } }),
    };
  }
}
```

**接口对齐 ai-time-run 现有**：

- `Tool` 接口已对（name / scope / description / run / snapshot / restore）
- `Probe` 接口已对（id / run）
- `featureId` 作为 sandbox key，跟 `Sandbox.execute({ featureId })` 一致
- `idempotencyKeyFor({ tool: 'code.repl', scope: 'sandbox.exec', featureId, payload: { code } })` 由 BREAK 4 WAL 自动覆盖

**对应 OpenAI 真实架构**：

| OpenAI Code Interpreter | ai-time-run CodeActInterpreter |
| --- | --- |
| tini + uvicorn FastAPI on :8080 | 单进程 Jupyter Kernel |
| `/channel` WebSocket | stdin/stdout + jupyter-client wire protocol |
| AsyncMultiKernelManager | `kernels: Map<featureId, ChildProcess>` |
| gVisor 隔离 | `node:child_process` + ulimit（v1 不做 gVisor） |
| Session 13 小时不活跃销毁 | feature 通过 + episode 结束 destroy kernel |

---

### 4.2 `src/code/tools/` — CodeToolSet（5 个 Tool）

```
src/code/tools/
├── search.ts        # code.search
├── doc.ts           # code.doc
├── symbol_nav.ts    # code.symbol_nav   ← 最高优先级（per ACL'24 ablation）
├── format.ts        # code.format
└── apply_patch.ts   # code.apply_patch  ← 学自 Anthropic + OpenAI v2
```

每个 tool 都是 `Tool` 接口实现，scope 全部 `repo.read`（除了 apply_patch 是 `repo.write`）。在 demo 里 5 个 tool 都注册到 `Sandbox`。

#### 4.2.1 `code.search`

```ts
export function makeSearchTool(root: string): Tool {
  return {
    name: 'code.search',
    scope: 'repo.read',
    description: 'ripgrep-backed search across the repo; respects .gitignore.',
    run: ({ pattern, glob, maxResults = 50 }) => {
      // execSync('rg', ['--json', '-g', glob, pattern, root])
      // Cap output at maxResults (per SWE-agent ACI: hard limit forces refine)
      const result = execSync('rg', ['--json', '-g', glob ?? '!*.lock', pattern, root], { encoding: 'utf8' });
      const lines = result.split('\n').filter(Boolean);
      return lines.slice(0, maxResults);
    },
    snapshot: () => ({}),
    restore: () => {},
  };
}
```

#### 4.2.2 `code.symbol_nav`（最高优先级）

```ts
export function makeSymbolNavTool(root: string, language: 'ts' | 'py'): Tool {
  return {
    name: 'code.symbol_nav',
    scope: 'repo.read',
    description: 'Resolve a symbol to its definition + references. TS uses ts-server; Python uses LSP.',
    run: async ({ symbol, kind }: { symbol: string; kind?: 'def' | 'refs' | 'all' }) => {
      // TS: `tsc --noEmit` + manual AST walk (lightweight)
      // Python: `pyright --json` or rope
      // Returns: [{ file, line, kind: 'def'|'ref', snippet }]
      return resolveSymbol(root, symbol, kind ?? 'all', language);
    },
    snapshot: () => ({}),
    restore: () => {},
  };
}
```

#### 4.2.3 `code.doc`

```ts
export function makeDocTool(adapter: FileSystemAdapter): Tool {
  return {
    name: 'code.doc',
    scope: 'repo.read',
    description: 'Pull docstring + type signature for a given file path + symbol.',
    run: ({ file, symbol }: { file: string; symbol?: string }) => {
      const content = adapter.read(file);
      return extractDoc(content, symbol);  // language-agnostic regex
    },
    snapshot: () => ({}),
    restore: () => {},
  };
}
```

#### 4.2.4 `code.format`

```ts
export function makeFormatTool(adapter: FileSystemAdapter, formatter: 'prettier' | 'ruff'): Tool {
  return {
    name: 'code.format',
    scope: 'repo.read',
    description: `Format ${formatter}-compliant files; returns unified diff.`,
    run: ({ files }: { files: string[] }) => {
      // prettier --check <files> or ruff format --check
      // returns: [{ file, diff, exit }]
      return formatFiles(adapter, files, formatter);
    },
    snapshot: () => ({}),
    restore: () => {},
  };
}
```

#### 4.2.5 `code.apply_patch`（学自 Anthropic + OpenAI v2）

```ts
export function makeApplyPatchTool(adapter: FileSystemAdapter): Tool {
  return {
    name: 'code.apply_patch',
    scope: 'repo.write',  // high-impact
    description: 'Apply a unified-diff-style patch. Partial failure -> whole patch rejected.',
    run: ({ patch }: { patch: string }) => {
      // Parse *** Begin Patch ... *** End Patch
      // Validate all hunks match current content (else reject whole)
      // Apply atomically; rollback on any single hunk failure
      return applyUnifiedDiff(adapter, patch);
    },
    snapshot: () => adapter.snapshotAll(),
    restore: (snap) => adapter.restoreAll(snap),
  };
}
```

---

### 4.3 `src/code/self_debug.ts` — SelfDebugLoop

**替换现有 `failure.attributed → rollback → 结束` 的路径**，改为：

```
failure.attributed
   ↓
SelfDebugLoop(attempt=1)
   ↓ claim.recorded("rubber-duck explanation")
   ↓ effect.requested(code.repl with explanation)
   ↓ effect.actualized
   ↓ evidence.attached(trace)
   ↓
   ├── ok? → feature.updated(passes=true)
   ↓
   no, attempts < max?
   ↓
SelfDebugLoop(attempt=2)
   ↓ claim.recorded("critique feedback")
   ↓ effect.requested(code.repl with refinement)
   ↓ ...
   ↓
no, attempts >= max?
   ↓
rollback.requested → effect.reverted
```

**实现**：

```ts
export interface SelfDebugOptions {
  maxAttempts?: number;       // default 3
  tracebackAdapter?: (lastError: string) => string;  // rubber-duck prompt builder
}

export class SelfDebugLoop {
  constructor(
    private ledger: Ledger,
    private interpreter: CodeActInterpreter,
    private reasoner: Reasoner,
    private opts: SelfDebugOptions = {},
  ) {}

  async run(
    featureId: string,
    lastFailure: { eventId: string; reason: string; trace: string },
  ): Promise<{ ok: boolean; attempts: number; finalTraceId?: string }> {
    const max = this.opts.maxAttempts ?? 3;
    for (let attempt = 1; attempt <= max; attempt++) {
      // 1. Rubber-duck: reasoner explains the last trace
      const explanation = await this.reasoner.explain(lastFailure.trace);

      const claim = this.ledger.append({
        type: 'claim.recorded',
        actor: ROLES.critic,
        payload: { statement: explanation, attempt },
        parent: lastFailure.eventId,
      });

      // 2. Record feedback event
      this.ledger.append({
        type: 'code.feedback',
        actor: ROLES.critic,
        payload: { featureId, attempt, explanation, prevTrace: lastFailure.trace },
        parent: claim.id,
      });

      // 3. Attempt refinement via code.repl
      const requested = this.ledger.append({
        type: 'effect.requested',
        actor: ROLES.generator,
        payload: { tool: 'code.repl', input: { featureId, code: /* refinement */ } },
        parent: claim.id,
      });

      const result = await this.interpreter.executeCell(featureId, /* refinement */);

      const actualized = this.ledger.append({
        type: 'effect.actualized',
        actor: ROLES.generator,
        payload: { tool: 'code.repl', output: result },
        parent: requested.id,
      });

      const evidence = this.ledger.append({
        type: 'evidence.attached',
        actor: ROLES.evaluator,
        payload: { source: 'code.cell.ok', kind: 'trace', ok: result.ok, value: result.value },
        parent: actualized.id,
      });

      this.ledger.append({
        type: 'code.retry',
        actor: ROLES.evaluator,
        payload: { featureId, attempt, success: result.ok },
        parent: evidence.id,
      });

      if (result.ok) {
        this.ledger.append({
          type: 'feature.updated',
          actor: ROLES.evaluator,
          payload: { featureId, passes: true, evidenceEventId: evidence.id },
          parent: evidence.id,
        });
        return { ok: true, attempts: attempt, finalTraceId: evidence.id };
      }

      lastFailure = { eventId: evidence.id, reason: result.detail ?? 'unknown', trace: JSON.stringify(result.value) };
    }
    return { ok: false, attempts: max };
  }
}
```

**集成点**：`orchestrator.ts` 当前 `rollback()` 调用前**先走 SelfDebugLoop**——如果 ok 则保留 effect，否则走原来的 rollback。

---

### 4.4 `src/code/reasoners/` — 3 个 Reasoner 模板

#### 4.4.1 `PseudoCodeReasoner`

**目标**：把 `Plan.steps: string[]` 升级为 `PseudoCodeStep[]`，token 节省 55-87%（per CodeAgents 2025）。

```ts
// types.ts 增量
export type PseudoCodeStep =
  | { kind: 'act'; tool: string; input: Record<string, unknown>; note?: string }
  | { kind: 'observe'; probe: string }
  | { kind: 'assert'; predicate: string; onFail?: 'retry' | 'rollback' | 'escalate' }
  | { kind: 'branch'; cond: string; then: PseudoCodeStep[]; else: PseudoCodeStep[] };

export interface PseudoCodePlan {
  id: string;
  featureId: string;
  claim: string;
  steps: PseudoCodeStep[];   // 替代 Plan.steps: string[]
  raw?: string;              // 序列化原文（保留可读性）
}
```

```ts
// src/code/reasoners/pseudo_code.ts
export function makePseudoCodeReasoner(llm: LLMCall): Reasoner {
  return {
    async plan(mission, features, context) {
      const plan: PseudoCodePlan = await llm.plan(mission, features, context, { format: 'pseudo-code' });
      this.ledger?.append({
        type: 'code.plan_recorded',
        actor: ROLES.planner,
        payload: { plan, tokensUsed: plan.raw?.length ?? 0 },
      });
      return { id: plan.id, featureId: plan.featureId, claim: plan.claim, steps: /* flatten for back-compat */ };
    },
    generate, critique, evaluate: /* delegate to base */
  };
}
```

#### 4.4.2 `QAReasoner`（per CodeAgent EMNLP'24）

```ts
export function makeQAReasoner(llm: LLMCall): Reasoner {
  // Adds qa-checker actor lane; QA-Checker reviews the critic's critique
  return {
    ...baseReasoner(llm),
    async critique(candidate, principles, context) {
      const base = await baseReasoner(llm).critique(candidate, principles, context);
      const qaCheck = await llm.structured({
        prompt: 'qa-checker-prompt',
        input: { candidate, base, context },
        schema: QA_CHECK_SCHEMA,  // { ok, on_topic: boolean, alignment_with_issue: number }
      });
      this.ledger?.append({
        type: 'critique.recorded',
        actor: 'qa-checker',
        payload: { candidateId: candidate.id, qaCheck },
      });
      return base.concat(/* augment with qaCheck */);
    },
  };
}
```

#### 4.4.3 `SelectorReasoner`（v1 占位）

```ts
// 第一版只做接口预留 + 单 LLM 多投票；多 LLM 并行留 v2
export function makeSelectorReasoner(llm: LLMCall, n: number = 3): Reasoner {
  return {
    ...baseReasoner(llm),
    async generate(plan, context) {
      const candidates = await Promise.all(
        Array.from({ length: n }, () => llm.generate(plan, context, { temperature: 0.7 })),
      );
      // syntax-based voting: longest distinct = winner (per TRAE)
      const winner = pickByDistinctness(candidates);
      return winner;
    },
  };
}
```

---

## 5. EventType 增量（落到 `types.ts`）

```ts
export type EventType =
  | /* ... existing 36 types ... */
  // BREAK 7 additions:
  | 'code.executed'         // REPL 跑完一 cell
  | 'code.feedback'         // self-debug 把 traceback 转成 explanation
  | 'code.retry'            // self-debug 决定修订并重跑
  | 'code.symbol_resolved'  // symbol_nav 解析到一个定义
  | 'code.apply_patch'      // unified-diff 写入
  | 'code.plan_recorded'    // pseudo-code plan 入账
  | 'code.escalate'         // sandbox deny heuristic 触发人工升级
```

每条都吃 BREAK 4 WAL（prevHash/hash chain）+ BREAK 4 idempotency key（`effect.intent` preamble）。

---

## 6. Workspace.instructions.md — AGENTS.md Chain（学自 Codex CLI / Codex Cloud / OpenAI Agents SDK v2）

**新文件**：`src/workspace/instructions.ts`

**行为**：

```ts
export interface InstructionChain {
  global: string;       // ~/.codex/AGENTS.md 或等价
  repo: string;         // <repo>/AGENTS.md
  cwd: string;          // <cwd>/AGENTS.md（最深优先）
  resolved: string;     // 三层合并（最深覆盖浅层）
}

export function loadInstructions(repoRoot: string, cwd: string, globalPath?: string): InstructionChain {
  // 1. 读 global → repo → cwd（同名 key 后者覆盖前者）
  // 2. 总大小 ≤ 32 KiB（Codex CLI 上限）
  // 3. 任何一层含 "break-glass: <keyword>" → 写入 ledger.code.plan_recorded
  return { global, repo, cwd, resolved };
}
```

**集成点**：`Mission.protectedIntentions` 之下注入到 `RuntimeOptions.reasoner` 的 `context` 参数，**永远不写入 ledger 作为 event**，只是上下文。

**为什么不动 Mission**：AGENTS.md 是开发者约定，**不是 principal 的意图契约**——分开两层，principal 的 `protectedIntentions` 不可被 AGENTS.md 改写。

---

## 7. Sandbox 政策升级：Permission Inversion

**当前**：`approve()` 默认 ask-first。

**新行为**（per Codex CLI）：

```
1. 默认：所有 tool run 在 process-local sandbox（Tool.snapshot/restore 已具备）
2. 默认 deny：
   - 工具不在 CapabilityGrant 白名单 → unknown-tool 拒绝（已对）
   - 工具 scope 跨 high-impactScope → 拒绝（已对）
3. 仅以下情况升级 ask：
   - high-impact scope + approvalThreshold='high-impact'（已对）
   - `isLikelySandboxDenied(output)` 检测到沙箱失败但用户期望成功（NEW）
4. auto-escalate（NEW）：
   heuristic 命中 → ledger.append({ type: 'code.escalate', payload: { output, suggested: 'DangerFullAccess' }})
   → orchestrator.approve() 询问用户
   → 用户批 → AuthorityEngine 临时发放 high-impact grant → 重试
```

```ts
// src/code/sandbox_heuristic.ts
export function isLikelySandboxDenied(output: CommandOutput): boolean {
  const signals = ['seatbelt', 'Landlock', 'bubblewrap', 'Operation not permitted', 'Permission denied'];
  const text = JSON.stringify(output);
  return !output.ok && signals.some(s => text.includes(s));
}
```

---

## 8. Mission 扩展：Manifest Abstraction

**新增字段**（types.ts）：

```ts
export interface WorkspaceManifest {
  mounts?: Array<{
    path: string;
    source: string;
    mode: 'read-only' | 'read-write';
    snapshot?: boolean;
    ephemeral?: boolean;     // ← 不入 snapshot
    secrets?: string[];      // ← 不进 sandbox env
  }>;
  env?: { public?: string[]; secrets?: string[] };
  ports?: Array<{ port: number; mode: 'internal-only' | 'host-bound' }>;
  startup?: string[];
  dependencies?: Array<{ name: string; manager: 'pip' | 'npm' | 'apt' | 'brew' }>;
}

export interface Mission {
  // ... existing fields ...
  manifest?: WorkspaceManifest;
}
```

**v1 实现范围**：仅做 schema 定义 + 在 `Ledger` 中**记录** manifest 字段（作为 mission.created payload 的一部分），**不强制隔离**——v2 接 sandbox provider 时再 enforce。

---

## 9. Verification 升级：Block-level + Test-First

### 9.1 Block-level（per LDB）

```ts
export interface BlockBlame {
  file: string;
  startLine: number;
  endLine: number;
  trace: string;
  rule?: string;   // optional rule id (lint rule, type error code)
}

export interface ProbeResult {
  ok: boolean;
  value: unknown;
  detail?: string;
  measurements?: Record<string, number | string | boolean>;
  block_blame?: BlockBlame[];  // ← NEW
}
```

**v1**：CodeActInterpreter.executeCell 在 result.ok=false 时自动附加 `block_blame`，从 traceback parse 出 `file:start_line:end_line`。

### 9.2 Test-First（per JoyCode）

**新流程**：在 `candidate.proposed` 之前插入 **`test.proposed` → `test.verified`** 步骤。

```ts
// orchestrator.ts 增量
const testPlan = await reasoner.planTests(feature);  // 生成 Fail2Pass + Pass2Pass
for (const test of testPlan.tests) {
  const testResult = await interpreter.executeCell(feature.id, test.code);
  recordTestVerified(test, testResult);
  if (!testResult.ok) {
    // test 失败 → 终止 patch 生成 → rollback
    return rollback(feature.id, 'test-first-failed');
  }
}
// test 全过 → 走原来的 candidate → critique → effect → probe
```

**v1 实现**：只在 demo 加一个 feature 演示；不强制所有 feature 走 test-first。

---

## 10. Skill Wrapper 升级（`SKILL.md`）

**新增 trigger 关键词**：

```yaml
keywords: codeagent, repo-level code, self-debug, code interpreter,
          symbol navigation, pseudo-code plan, multi-agent code review,
          test-first, apply-patch, AGENTS.md, manifest, sandbox escalate
```

**新增 "CodeAgent variants" 段**：

```markdown
## CodeAgent variants (BREAK 7)

When the user request matches any CodeAgent trigger, choose a variant:

| Variant | Tool set | Reasoner | Mission.manifest |
| --- | --- | --- | --- |
| **codeact** | code.repl + code.search + code.symbol_nav + code.doc + code.format | PseudoCodeReasoner | required (workspace) |
| **self-debug** | code.repl + code.apply_patch | base Reasoner + SelfDebugLoop | optional |
| **multi-agent review** | all 6 tools | QAReasoner | required |
| **test-first** | all 6 tools + code.repl | JoyCode-style (test-first) | required |

After choosing a variant, run:

  node "D:\personal skill\ai-time-run\dist\cli.js" codeagent --variant codeact --store <dir>

The variant writes to a fresh ledger and renders trace.html with `code.*` events highlighted.
```

---

## 11. 6 步实施路线

### 11.1 路线总览

| 步 | 周 | 产出 | 不破坏什么 |
| --- | --- | --- | --- |
| **W1** Schema & types | 0.5d | `types.ts` 加 5 个 EventType + PseudoCodeStep + Mission.manifest + ProbeResult.block_blame | 不破坏现有 36 个 EventType |
| **W2** CodeActInterpreter + 5 Tools | 2d | `src/code/interpreter.ts` + `src/code/tools/{search,doc,symbol_nav,format,apply_patch}.ts` | 不注册到默认 demo |
| **W3** SelfDebugLoop + SandboxHeuristic | 1d | `src/code/self_debug.ts` + `src/code/sandbox_heuristic.ts` | 仅替换 `failure.attributed → rollback` 中间路径 |
| **W4** PseudoCodeReasoner + QAReasoner | 1d | `src/code/reasoners/*.ts` | 仅 demo 选用，default Reasoner 不动 |
| **W5** CodeAgent Demo + trace.html 高亮 | 1d | 新增 `node dist/cli.js codeagent --variant codeact` 命令 | 不替换现有 demo |
| **W6** SKILL.md 升级 + 文档 | 0.5d | `SKILL.md` 加 trigger + variants 段 | 不改现有触发词 |

**总投入：~6 dev-days**。每一步独立可合并。

### 11.2 测试策略

| 测试 | 范围 | 数量 |
| --- | --- | --- |
| 单元（vitest） | CodeActInterpreter / 5 Tools / PseudoCodeReasoner / SelfDebugLoop | ~20 |
| 集成（vitest） | orchestrator with BREAK 7 wiring | ~5 |
| Demo 端到端 | `node dist/cli.js codeagent --variant codeact` | 3 scenarios |
| Episode 验收 | H3 harness level + 11+N responsibilities | 自动 |
| Tamper | 沿用 BREAK 4 `tamper` 命令 | 自动 |

### 11.3 Demo 场景（必须通过的 3 个）

#### Scenario A — CodeAct (codeact variant)

```
Feature: refactor a TypeScript function `parseConfig` to handle null inputs
Expected: 5 events minimum: plan_recorded → code.executed (cell 1: import) →
          code.executed (cell 2: parseConfig v2) → code.executed (cell 3: assert) →
          evidence.attached(ok) → effect.verified → feature.updated(passes=true)
```

#### Scenario B — Self-Debug

```
Feature: fix a Python function `factorial` that fails on n=0
Expected: failure.attributed → SelfDebugLoop:
          code.feedback(attempt=1) → code.retry → code.executed → evidence.ok=false
          → code.feedback(attempt=2) → code.retry → code.executed → evidence.ok=true
          → effect.verified → feature.updated
Total attempts ≤ 3
```

#### Scenario C — QA-Checker (multi-agent review variant)

```
Feature: write a PR review comment for a hypothetical patch
Expected: plan_recorded → candidate.proposed (review) → critique.recorded (qa-checker)
          → revision.requested → candidate.proposed → critique.recorded (ok=true)
          → feature.updated
```

---

## 12. 兼容性 + Risk

### 12.1 兼容性

- 所有 BREAK 1-6 不变式保留：append-only ledger / WAL hash chain / idempotency keys / constitution amendment guardrails
- 现有 4-feature demo + tamper demo 行为**完全不变**——BREAK 7 是新增 namespace，不改现有事件类型
- Episode 报告 `responsibilities: 11/11 covered` 保留；v2 可升级到 12/12

### 12.2 Risk + 缓解

| Risk | 缓解 |
| --- | --- |
| Jupyter Kernel 依赖（需 Python + jupyter_client） | 提供 docker / nix 打包文档；单元测试用 mock；端到端 demo 标 `requires-python` |
| CodeActInterpreter 执行时间失控 | `cellTimeoutMs` 强制；`memoryLimitMb` ulimit |
| Pseudo-code plan 模型不会写 | 提供 few-shot prompt template；fallback 到自然语言 plan |
| AGENTS.md chain 解析复杂（frontmatter / glob / include） | v1 只做简单 frontmatter + 文本合并；v2 接 langchain.text_splitter |
| Test-First 加慢 critical path | 默认关闭；only-on-`mission.approvalThreshold` |
| `SelectorReasoner` 多 LLM 增加成本 | v1 只做单 LLM 多 sample；多 provider 留 v2 |

### 12.3 Open Questions（需要用户决策）

1. **CodeActInterpreter 依赖 jupyter_client npm 还是 python 子进程？**
   - A. python 子进程（更通用，需要装 Python）
   - B. `jupyter-client` npm（更快，但只能 Python 2/3 协议）
2. **Pseudo-code plan 是否默认启用？**
   - A. 默认 enable（更省 token，但 prompt 复杂度高）
   - B. opt-in via `mission.manifest.format = 'pseudo-code'`
3. **Test-First 是否默认开启？**
   - A. 默认开启（更稳，但首次 demo 慢）
   - B. opt-in via `mission.approvalThreshold`
4. **`SelectorReasoner` 多 LLM 是否 v1 实现？**
   - A. v1 实现（成本 +30%，但接近 TRAE 效果）
   - B. v1 只占接口（v2 再做）
5. **`Workspace.instructions.md` 是否覆盖 Mission.protectedIntentions？**
   - A. 永不覆盖（设计已经决定）
   - B. 全局层可以追加（principal 可控）

---

## 13. 后续 BREAK（预告）

| BREAK | 主题 | 时机 |
| --- | --- | --- |
| BREAK 8 | Long-lived PTY / `UnifiedExecProcessManager`（per Codex CLI） | v0.3 |
| BREAK 9 | Cross-container snapshot + rehydrate（per OpenAI v2） | v0.4 |
| BREAK 10 | Multi-LLM selector + cost per resolved issue tracking | v0.5 |

---

> 本设计稿基于 docs/14 学习笔记的 8 项核心研究 + ai-time-run 现有 src 接口。
> 实施前请先 review §12.3 的 5 个 Open Questions，并确认 §11 的 6 步路线预算。
