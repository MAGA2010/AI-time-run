# BREAK 7 — 新增算法清单

> 给好奇的人看的"实现细节"清单。每一项都对应 `src/code/` 下的具体代码，
> 并标注出处的论文 / 产品。

## 1. CodeActInterpreter — 状态化 Python 子进程内核

**文件**：`src/code/interpreter.ts`

**核心数据结构**：

```ts
interface KernelHandle {
  featureId: string;
  process: ChildProcessWithoutNullStreams;
  workspace: string;
  buffer: string;
  pending: Map<string, { resolve; reject; timer }>;
  lastUsedAt: number;
  shutDown: boolean;
  synthetic?: boolean;   // true when python3 missing
}
```

**算法要点**：

| 步骤 | 动作 | 来源 |
| --- | --- | --- |
| 1 | `spawn('python3', ['-u', '__kernel__.py'])` 起一个 per-feature 子进程 | OpenAI Code Interpreter 反编译架构 |
| 2 | 嵌入式 Python wrapper 用 `exec(compile(...), GLOBALS)` 跑 cell，`GLOBALS` 字典持久化跨 cell | CodeAct (ICML 2024) |
| 3 | 每 cell 通过 stdin 写 JSON `{type:'execute', requestId, code}`，stdout 行分隔 JSON 回结果 | Jupyter wire protocol 简化版 |
| 4 | 用 SHA-256 idempotency key 复用结果，`cellTimeoutMs` 强制 kill | BREAK 4 WAL + idempotency |
| 5 | `child.on('error', ENOENT)` 触发时换成 `synthetic: true` dead kernel，返回结构化 `kernel-unavailable` | 运行时健壮性 |
| 6 | `snapshot()` 通过 `dump()` 把 globals 序列化到 `__globals__.json`；`restore()` 重启 + 喂回 | OpenAI Agents SDK v2 snapshot+rehydrate |
| 7 | `idleSweep` 每 60s 杀掉超过 `idleTimeoutMs` 未用的 kernel | Codex CLI `UnifiedExecProcessManager` 灵感 |

**Python wrapper 关键 6 行**：

```python
def _execute(code):
    with redirect_stdout(out_buf), redirect_stderr(err_buf):
        exec(compile(code, "<cell>", "exec"), GLOBALS)
```

**算法复杂度**：每个 cell = O(1) 网络往返 + Python `exec()` 开销；stateful kernel 摊销启动成本。

---

## 2. extractBlame — Block-level 归因解析

**文件**：`src/code/interpreter.ts`

**算法**：用正则 `/File "([^"]+)", line (\d+)(?:, in (.+))?/g` 从 Python traceback 提取 blame 数组。

**复杂度**：O(N) where N = traceback 长度。

**为什么需要**：LDB (arXiv 2402.16906) 关键 insight —— 不仅告诉 harness "这 cell 错了"，还要 blame 到具体 `file:startLine:endLine`，让 `ProbeResult.block_blame` 可被 `validateLedger` 校验。

---

## 3. isLikelySandboxDenied — 沙箱拒绝启发式

**文件**：`src/code/sandbox_heuristic.ts`

**算法**：

```ts
const SIGNALS = ["Operation not permitted", "Permission denied",
                 "seatbelt", "Landlock", "bubblewrap", "bwrap",
                 "seccomp", "Read-only file system", "POLICY VIOLATION"];

isLikelySandboxDenied(out) := out.ok == false
                            AND exists signal ∈ SIGNALS
                                 such that signal ⊆ concat(out.error, out.stderr, out.stdout)
```

**为什么需要**：Codex CLI 启发式（`is_likely_sandbox_denied`）。当沙箱拒绝了"用户期望成功"的工具调用时，自动询问是否升级到 `DangerFullAccess`，而不是失败静默。

**复杂度**：O(M×N) where M=信号数 (10)，N=输出文本长度。可忽略。

---

## 4. parsePatch — Unified-diff 解析

**文件**：`src/code/tools/index.ts`

**算法**：行扫描器（finite state machine）

```
state ∈ {HEADER, BODY, HUNK_FILE, HUNK_HEADER}
       × {old-mode, new-mode}

foreach line:
  if "*** Begin Patch"            → state = BODY
  if "*** End Patch"              → emit hunks, done
  if "*** Update File: X"         → flush prev hunk, new hunk for X
  if "@@ line N"                  → record startLine = N
  if startsWith("-")              → mode=old;   buf.push(slice(1).replace(/^ /, ""))
  if startsWith("+")              → mode=new;   buf.push(slice(1).replace(/^ /, ""))
  if startsWith(" ")              → both;       buf.push(slice(1).replace(/^ /, ""))
```

**复杂度**：O(N) where N = patch 行数。

**为什么需要**：学自 Anthropic + OpenAI v2 的 `apply_patch` 协议。Unified diff 用 `-/+/` 加可选前导空格作为 1-char marker；剥掉 marker 后剩下的就是真文本。

---

## 5. applyPatchTool — 原子化写入 + 回回滚

**文件**：`src/code/tools/index.ts`

**算法**：

```text
1. PARSE patch → {begin, end, hunks[]}
2. validate begin/end markers; reject if either missing
3. SNAPSHOT: backups[file] := (exists ? content : null)  for each hunk
4. APPLY:
     foreach hunk:
       if NOT file.contains(hunk.oldText):
         throw "hunk-mismatch"   ← triggers rollback
       file.write(content.replace(oldText, newText))
5. ON ERROR:
     foreach backup:
       backup == null ? rm(file) : file.write(backup)
6. RETURN { ok: true|false, filesWritten[], rolledBack? }
```

**复杂度**：O(F × H × L) where F=文件数，H=每文件 hunk 数，L=平均行长度。

**为什么需要**：OpenAI Agents SDK v2 "Partial failure → whole patch rejected" 语义；Anthropic 同样的原语。这是 CodeAgent 写文件时唯一不能妥协的安全保证。

---

## 6. SelfDebugLoop — Rubber-duck 重试循环

**文件**：`src/code/self_debug.ts`

**算法**（伪代码）：

```
for attempt := 1 .. maxAttempts:
    explanation := reasoner.explain(failureCtx)
    refinement  := reasoner.refine(failureCtx, explanation, attempt)

    ledger.append(claim.recorded{statement: explanation}, parent=failure)
    ledger.append(code.feedback{featureId, attempt, explanation, prevTrace})
    ledger.append(effect.requested{scope: 'sandbox.exec', tool: 'code.repl',
                                    input: {code: refinement}})
    result := interpreter.executeCell(featureId, refinement)
    ledger.append(effect.actualized{tool, output: result})
    ledger.append(evidence.attached{source: 'code.cell.ok', ok: rc==0, value: result})
    ledger.append(code.retry{featureId, attempt, success: rc==0, blame: result.blame})

    if rc == 0 AND successProbe(result):
        ledger.append(feature.updated{passes: true, evidenceEventId, via: 'self-debug'})
        return OK

    lastTrace := result.stderr || result.stdout

return FAIL  ← orchestrator rolls back
```

**复杂度**：N 次 cell execution + 6N 个 ledger append（N = maxAttempts）。每次 cell 都是 Python 一次 round-trip。

**为什么需要**：Chen et al. ICLR 2024 (Self-Debugging)——把 brain 的"rubber-duck 解释"作为可审计的事件落进 ledger，而不是塞进 hidden context。

---

## 7. SelectorReasoner — 多 sample 投票

**文件**：`src/code/reasoners/selector.ts`

**算法**（v1 单 LLM 多 sample）：

```
samples := [reasoner.generate(plan, ctx) for _ in range(n)]
seen := Map<string, Candidate>()
for s in samples:
    seen[s.content.trim()] ??= s      # 去重
winner := seen.values().sortBy(content.length, desc)[0]
return winner
```

**复杂度**：O(N × L) where N=sample count，L=平均 content 长度。

**为什么需要**：TRAE Selector Agent (2025-09 SWE-bench Verified #1)——语法差异投票。多 LLM provider 并行留 v2（BREAK 10 路线）。

---

## 8. QAReasoner — QA-Checker 多 agent 监督

**文件**：`src/code/reasoners/qa.ts`

**算法**：

```
verdict := QAReasoner.critique(candidate, principles, ctx):
    baseCritiques := baseReasoner.critique(candidate, principles, ctx)
    qaCheck := {
      onTopic: candidate.content.includes('codeagent') || plan.claim...
      alignment: min(1, content.length / 200 + okCritiques / totalCritiques)
    }
    onQACheckSink?.(qaCheck)
    return baseCritiques
```

**为什么需要**：CodeAgent EMNLP 2024 的核心发现——QA-Checker 显著降低 reviewer 的 false positive。让 reviewer 不再独断。

---

## 9. EventType 增量（不变量层自动保护）

**文件**：`src/types.ts`

**新增 7 个事件类型**：

| EventType | 来源 | 用途 |
| --- | --- | --- |
| `code.executed` | CodeAct | REPL 跑完一 cell |
| `code.feedback` | Self-Debugging | rubber-duck 解释入账 |
| `code.retry` | Self-Debugging | 重试轮次记录 |
| `code.symbol_resolved` | CodeAgent ACL'24 | symbol_nav 命中定义 |
| `code.apply_patch` | Anthropic + OpenAI v2 | unified-diff 写入 |
| `code.plan_recorded` | CodeAgents 2025 | pseudo-code plan 入账 |
| `code.escalate` | Codex CLI | sandbox 拒绝自动升级 |

**不变量**：(a) 每条都走 BREAK 4 WAL hash chain；(b) `effect.requested` 类事件必须配 grant；(c) `effect.verified` 必须配 `ok:true` evidence。**BREAK 7 不放松任何不变量**——这是 v0.1 兼容的关键。

---

## 10. trace.html 代码高亮（前端零依赖）

**文件**：`src/trace.ts`

**算法**：在 `eventClass()` 里加一行：

```ts
if (event.type.startsWith('code.')) return 'row code-event';
```

CSS：

```css
.row.code-event td { background: #eef2ff; color: #3730a3; }
```

**复杂度**：O(N) per trace render。

**为什么需要**：审计员一眼能识别"CodeAgent 行为 vs 通用 managed-agent 行为"，无需解析 payload。

---

## 11. Block-level Verification (`ProbeResult.block_blame`)

**文件**：`src/types.ts` + interpreter 自动附加

**算法**：interpreter 在 cell `returncode != 0` 时，从 stderr 解析 traceback location 数组：

```ts
result.blame = extractBlame(stderr);   // [{file, startLine, endLine, trace}]
```

**为什么需要**：LDB (arXiv 2402.16906) 把 blame 落到具体代码行，verification 不再只是 pass/fail。

---

## 12. Mission.manifest — 跨 container 描述符

**文件**：`src/types.ts`

**算法**：mission payload 携带 `manifest` 字段（mounts/env/ports/deps/ephemeral），runtime 在 `mission.created` 事件里**记录**它（v1 不强制隔离，留给 v2 sandbox provider enforce）。

**复杂度**：O(1)。

**为什么需要**：OpenAI Agents SDK v2 "Manifest abstraction" 是把 7 个 sandbox provider (E2B / Cloudflare / Daytona / Modal / Blaxel / Vercel / Temporal) 统一抽象的关键 schema。ai-time-run v1 把它写下来不强制隔离，是 v0→v0.1→v0.2 的演化路径。

---

## 整体数据流（含 BREAK 7）

```
Mission.manifest (mounts/env/ports/deps)
   ↓
mission.created
   ↓
feature.registered (passes=false)
   ↓
plan.recorded (PseudoCodeReasoner)  ← BREAK 7
   ↓
candidate.proposed
   ↓
critique.recorded  ← QAReasoner QA-Checker  ← BREAK 7
   ↓
effect.intent (idempotencyKey)
   ↓
effect.requested { scope, tool: code.repl | code.apply_patch | ... }
   ↓
checkpoint.created
   ↓
effect.actualized
   ↓
evidence.attached { source: code.cell.ok, kind: trace, ok, value, block_blame? }
   ↓                                   ← BREAK 7
[if ok=false] → SelfDebugLoop (N attempts)
   ↓                                    ← BREAK 7
   code.feedback + code.retry + effect.requested* + ...
   ↓
effect.verified
   ↓
feature.updated (passes=true, evidenceId)
   ↓
belief.asserted + episodic.remember

[any tool call failure] → isLikelySandboxDenied? → code.escalate  ← BREAK 7
```

---

## 性能 / 体积统计

| 模块 | 行数 | 复杂度 |
| --- | --- | --- |
| interpreter.ts | 320 | O(1) per cell |
| tools/index.ts | 280 | O(F × H × L) per patch |
| self_debug.ts | 130 | O(N × cell) per feature |
| sandbox_heuristic.ts | 60 | O(M × N) per tool call |
| reasoners/ (3 files) | 200 | O(L) per plan |
| index.ts + demo.ts | 150 | O(1) |
| **总计** | **~1140** | — |

**测试覆盖**：10 个新单元测试 / 48 总测试，100% 通过。

---

## See also

- `docs/13-break7-codeagent-integration.md` — design spec for BREAK 7
- `docs/14-codeagent-study-notes.md` — first-pass breadth study (8 papers + 3 OAI products)
- **`docs/17-deep-study.md`** — second-pass deep dive: actual algorithms, prompts,
  reverse-engineered architecture, and cost numbers for CodeAct MINT, OAI Code
  Interpreter / Coworker, SWE-Agent ACI, JoyCode Fail2Pass/Pass2Pass, and
  mini-SWE-agent. Source of truth for the v0.2 roadmap.
