# CodeAgent & OpenAI 融合做法 学习笔记

> 目的：把研究过的所有材料系统化，作为 BREAK 7 (CodeAgent Integration) 设计稿 docs/13 的输入。
> 范围：CodeAgent 家族 8 篇核心论文 + OpenAI 三套产品 (Code Interpreter / Codex CLI / Codex Cloud) + OpenAI Responses API + Agents SDK v2 + 同生态参考 (SWE-Agent / TRAE / JoyCode) + SWE-bench Verified 现状 + 安全事件 + ai-time-run 对接点矩阵。

---

## 1. CodeAgent 家族（论文谱系）

### 1.1 CodeAct（Wang et al., ICML 2024, arXiv:2402.01030）

> *Executable Code Actions Elicit Better LLM Agents*

**核心思想**：把 agent 动作从 JSON / 文本统一为 **Python 代码**，由 interpreter 执行。

**4 项关键发现**：

| 维度 | 提升 |
| --- | --- |
| HotpotQA 胜率 | 相对 JSON + text baseline +20% |
| Multi-turn tool use 胜率 | 显著优于 ReAct / ReWOO |
| 对话轮数 | -30%（同等任务） |
| 复杂 logic / numeric | -8% 错误率 |

**为什么有效**：
1. **代码本身携带控制流和数据流**——`for / if / try` 比 JSON 的离散参数更强
2. **Interpreter 自带 error feedback**——traceback 直接喂回模型，无需外部 verifier
3. **可调用 PyPI 包**——agent 直接 `import pandas as pd`
4. **多 turn 自修正**——`assert` + `try/except` 让模型自我 debug

**给 ai-time-run 的直接启示**：`code.interpreter.ts` 应该用 **Jupyter Kernel 子进程**（而非 `child_process.exec("python3 ...")`），保证 feature 内部 stateful（变量复用），episode 结束销毁。

**衍生工作**：CodeActInstruct（多 turn 训练数据集）、Code-Feedback（执行 + 反馈数据集）。

---

### 1.2 CodeAgent ACL 2024（Zhang et al., arXiv:2401.07339）

> *Enhancing Code Generation with Tool-Integrated Agent Systems for Real-World Repo-level Coding Challenges*

**两个核心贡献**：

#### A. 5 工具集

| 工具 | scope | 作用 |
| --- | --- | --- |
| `Search` | `repo.read` | 跨文件搜索 |
| `Doc` | `repo.read` | 拉 docstring / 类型签名 |
| `Symbol Navigation` | `repo.read` | **最关键工具**（per ablation） |
| `Format` | `repo.read` | prettier / ruff format diff |
| `REPL` | `sandbox.exec`, **high-impact** | 代码执行 + traceback |

#### B. 4 种 agent 策略（消融对比）

| 策略 | 特点 | 适合 |
| --- | --- | --- |
| ReAct | Thought → Action → Observation | 通用 |
| Tool-Planning | 先 plan 再 act | 长任务 |
| OpenAI Function Calling | JSON schema 触发 | 工具少 |
| Rule-based | 固定模板 | 简单 fix |

**消融最关键结论**：去掉 `Symbol Navigation` 性能下降最大——光给 agent 搜索不够，**必须给它"跳转到定义"**的语义动作。

**给 ai-time-run 的启示**：
- 5 个 Tool 1:1 落到 `Sandbox.register()`，每个走 `Tool` interface
- `code.symbol_nav` 优先级最高，在 demo 里要先展示
- 4 种策略映射到 4 个 Reasoner 模板，让 harness 配置选

---

### 1.3 Self-Debugging（Chen et al., ICLR 2024, arXiv:2304.05128）

> *Teaching Large Language Models to Self-Debug*

**核心**：frozen model 用 few-shot prompting 让其"自我 debug"——通过 **解释代码 + 检查执行 trace** 找到 bug，无需人类反馈或外部标签。

**两种模式**：

| 模式 | 触发 | 动作 |
| --- | --- | --- |
| **Rubber-duck** | 任何代码生成后 | "让模型解释自己写的代码"→ 找逻辑漏洞 |
| **CRITIC** | 执行报错后 | 让模型读 traceback → 解释原因 → 修订 |

**关键发现**：
- Self-debug 的相对提升在 **GPT-3 / Codex 上 5-9%**，但 **GPT-4 自身已有自我修正能力**，Self-debug 提升降到 1-3%
- **执行 trace** 比**仅错误信息**有效得多——给模型看到 traceback 而不是 "wrong answer"

**给 ai-time-run 的启示**：failure.attributed 后**不直接 rollback**，而是 **进入 SelfDebugLoop，最多 N 轮**（默认 3），每轮写 `claim.recorded` + `evidence.attached(trace)`，N 轮失败才 rollback。直接替代当前的 "失败 → 立即回滚" 路径。

---

### 1.4 OpenCodeInterpreter（Zheng et al., arXiv:2402.14658）

> *Integrating Execution, Feedback, and Refinement*

把 GPT-4 Code Interpreter 的能力开源化：

- **Code-Feedback 68K**：多 turn 数据集（code + execution + human feedback + refinement）
- **DS-33B 训练**：HumanEval **83.2%**，MBPP **76.4%**，逼近 GPT-4（87.7% / 89.0%）
- **集成执行 + 人类反馈的迭代 refinement**——这是 OpenAI Code Interpreter 训练范式的开源近似

**给 ai-time-run 的启示**：
- `EpisodicMemory` schema 应该新增 **`code_feedback: { execution: string, human_comment?: string, refinement: string }`**
- runtime 可以通过 `demo + episode` 自动生成 Code-Feedback 风格的多 turn 数据，用来 fine-tune Reasoner（"brain is swappable"原则 → 可以用 ai-time-run 自己的 trace 训练更好的 brain）

---

### 1.5 LDB（arXiv:2402.16906）

> *Debug like a Human: A Large Language Model Debugger via Simulating Runtime Execution*

执行时 **block-level runtime trace verification**——不只看最终 ok/value，而是看代码执行到哪一步出问题。

**比 Self-Debugging 高 9.8%**（fix 成功率）——关键差异：**把 blame 落到具体的代码块**，而不只是"这个 function 错了"。

**给 ai-time-run 的启示**：`Probe.run()` 当前只看 `{ok, value, detail}`，升级为支持 **`block_blame?: { file, start_line, end_line, trace }`**——verification 不仅说 pass/fail，还告诉 harness / 模型"哪几行是问题源头"。

---

### 1.6 CodeAgent EMNLP 2024（Tang et al., arXiv:2402.02172）

> *Autonomous Communicative Agents for Code Review*

**多 agent 架构**：

| Agent | 职责 |
| --- | --- |
| Author | 写 patch |
| Reviewer | 提意见 |
| QA-Checker | **监督者**——审 reviewer 的意见是否切题、对齐 issue |
| Decision | 仲裁 |

**关键 evidence**：QA-Checker 显著降低 false positive（reviewer 提了一堆 issue 但很多无关）。

**给 ai-time-run 的启示**：CRITIQUE + 一次 EVALUATOR 不够；要加 **QA-Checker 作为第三个 reviewer**，actor lane 名字直接复用（`actor: 'qa-checker'`）。

---

### 1.7 CodeAgents 2025（arXiv:2507.03254）

> *A Codified Multi-Agent Reasoning Framework*

把 task / plan / feedback / tool call 全编为 **modular pseudo-code**（带控制流、布尔变量、类型）：

```
[ plan ]
var task := "GAIA-Q42"
var role := "explorer"
var steps := []

[ act ]
loop until steps.empty():
  call tool(steps.pop(), role=role)
  record(feedback)
```

**关键成果**：
- Token 节省 **55-87%**（vs 自然语言 multi-agent）
- 规划任务 GAIA / HotpotQA / VirtualHome 绝对提升 **3-36%**

**给 ai-time-run 的启示**：`Plan.steps: string[]` 升级为 **`PseudoCodeStep[]`**：
```ts
type PseudoCodeStep =
  | { kind: 'act', tool: string, input: Record<string, unknown> }
  | { kind: 'observe', probe: string }
  | { kind: 'assert', predicate: string }
  | { kind: 'branch', cond: string, then: PseudoCodeStep[], else: PseudoCodeStep[] }
```
token 经济 + 易于 model verifier + 易于 code review。

---

### 1.8 SWE-Agent（NeurIPS 2024，Princeton）

详见 §4.1。

---

## 2. OpenAI 三套产品 + Responses API / Agents SDK

### 2.1 ChatGPT Code Interpreter（Advanced Data Analysis）

| 维度 | 设计 |
| --- | --- |
| 形态 | ChatGPT 内置 tool，非独立产品 |
| 沙箱 | OpenAI 托管 VM（gVisor 隔离） |
| 网络 | **默认关**（模型能 import 预装包，不能外联） |
| 会话 | 单次 Chat 会话内 stateful kernel，13 小时不活跃后销毁 |
| 文件 | 上传 / 下载双向 |
| 价格 | $0.03 per session（2024 定价） |

**反编译揭示的架构**（ryan.govost.es, 2024）：
- 容器内 `tini + uvicorn(FastAPI) on :8080`
- `/channel` WebSocket 双向通信
- `AsyncMultiKernelManager` 管理每个 user 一个 Jupyter Kernel
- gVisor 在 host 层隔离
- 子进程 = Jupyter Kernel（**stateful**）

**给 ai-time-run 的启示**：`code.interpreter.ts` 仿照此架构：用 `python -m jupyter kernelgateway` 或裸 `jupyter_client` 起 Kernel，**保留状态跨 cell**（feature 内），feature 结束 `kernel.shutdown()`。

---

### 2.2 OpenAI Codex CLI（2025-04 开源 → 2025-06 重写为 Rust）

#### 2.2.1 仓库结构

```
codex/
├── cli/              # CLI 入口
├── tui/              # ratatui + crossterm TUI
├── core/             # 核心协议层
├── exec/             # 单次 exec 模型
├── exec-server/      # 长期运行 exec 服务
├── app-server/       # JSON-RPC for Desktop App
├── linux-sandbox/    # Linux Bubblewrap + Landlock + seccomp
├── process-hardening/# Windows Restricted Tokens
├── keyring-store/    # 凭证存储
├── login/            # OAuth / API key
└── network-proxy/    # 出网代理
```

60+ 个 crate，每个职责单一。

#### 2.2.2 SandboxPolicy（默认 opt-out）

```rust
pub enum SandboxPolicy {
    ReadOnly,
    WorkspaceWrite {
        writable_roots: Vec<PathBuf>,
        network_access: bool,
    },
    DangerFullAccess,
    ExternalSandbox { sandbox: Box<dyn ExternalSandbox>, exec_wrapper: Option<PathBuf> },
}
```

**关键设计**：每个命令**默认过沙箱**（opt-out），不是 opt-in。

#### 2.2.3 OS 沙箱实现

| 平台 | 技术 | 隔离强度 |
| --- | --- | --- |
| **macOS** | Seatbelt + SBPL 动态生成 | 内核强制 |
| **Linux** | Bubblewrap（自带）+ Landlock fallback + seccomp-BPF（net） | 内核强制 |
| **Windows** | Restricted Tokens + Job Objects + Windows Sandbox via DACL | 内核强制 |

#### 2.2.4 沙箱拒绝的自动检测

```rust
fn is_likely_sandbox_denied(output: &CommandOutput) -> bool {
    // heuristic: 出现 seatbelt / Landlock / bwrap / "Operation not permitted"
    // 且 exit code 非 0，且是网络/进程类命令
}
```

如果检测到沙箱拒绝了用户实际想做的操作，Codex **自动询问**是否升级到 `DangerFullAccess`——"沙箱失败不应让用户无所适从"。

#### 2.2.5 `codex debug seatbelt`

```bash
codex debug seatbelt -- ls /tmp
# 任何命令先通过沙箱试运行，看会发生什么
```

"先试运行"模式—— ai-time-run 已经有 `runtime.simulate(toolName, input)`，但输出没那么友好。

#### 2.2.6 Environment Scrubbing

启动时**重建 `PATH`** 而不是 append；`HOME` 重定向到沙箱内临时目录；`TMPDIR` 也重写。子进程拿到的是"看起来正常但被隔离"的环境。

#### 2.2.7 ToolOrchestrator = 三件事总闸

```rust
pub struct ToolOrchestrator {
    sandbox: SandboxManager,
    approval: ApprovalOrchestrator,  // ask / on-request / never
    handler:  ToolHandler,            // ToolRequest -> side effect
}
```

每一次 tool call 同时问三个问题：**1) 沙箱能让它跑吗？2) 用户是否需要看到/批准？3) 实际跑出来的 side effect 是什么？**。三者解耦，所以同一把 shell 在不同 session 的策略组合可完全不同。

#### 2.2.8 UnifiedExecProcessManager

长进程（`npm run dev` 这种）走专门管理器：
- **HeadTailBuffer** 1 MiB head + 1 MiB tail
- 最多 64 个并发 PTY
- 输出变更才推给模型

#### 2.2.9 TUI / App Server

- TUI：`ratatui` + `crossterm`，alt screen buffer、bracketed paste、tree-sitter-bash、pulldown-cmark
- App Server：WebSocket + HTTP，**专用 JSON-RPC**给 Codex Desktop App
- 三原语：**Thread / Turn / Item**（OpenAI Codex 全平台共用）

---

### 2.3 Codex Cloud（2025-05）

| 维度 | 设计 |
| --- | --- |
| 形态 | SaaS，每个任务一个独立 sandboxed container |
| 仓库预加载 | git 仓库 + configured deps |
| 网络 | 默认关 |
| 模型 | Codex-1（o3 fine-tuned for software engineering） + RL on real coding tasks |
| 项目约定 | AGENTS.md（global → repo → cwd） |
| 可验证证据 | "Codex 通过引用终端日志和测试输出来提供其操作的可验证证据" |
| 时长 | 1-30 分钟/任务 |
| 闭环 | 用户审阅 → 请求修订 → 开 GitHub PR → 本地 merge |

**给 ai-time-run 的启示**：可验证证据的话术是 OpenAI 在产品文档里**明写出来**的——继续做 `effect.verified ← evidence.attached(trace)` 既是技术正确也是产品话术。

---

### 2.4 Responses API + Agents SDK v2（2025-03 → 2026-04）

#### 2.4.1 三层抽象

| 层 | 职责 |
| --- | --- |
| Reasoning 模型 | 选下一步动作 |
| Harness / Runtime | 控制平面：approval / trace / recovery / credentials / memory / 状态 |
| Sandbox | 执行平面：文件 / shell / 依赖 / mount / port / snapshot |

**关键安全原则**：`credentials never enter the execution environment`。

#### 2.4.2 Manifest Abstraction（最值得借鉴）

```yaml
kind: manifest
workspace:
  mounts:
    - path: /repo
      source: $REPO_URL
      mode: read-only
      snapshot: true
    - path: /tmp/scratch
      ephemeral: true              # 不入 snapshot
      secrets:                     # 不进 sandbox env
        - $GITHUB_TOKEN
  env:
    public:
      - NODE_ENV=production
  ports:
    - 8080:internal-only
  startup:
    - npm install
    - npm run build
  dependencies:
    - name: pytest
      manager: pip
    - name: ffmpeg
      manager: apt
```

7 个 sandbox provider 共用同一份 manifest：
- **E2B / Vercel**：Firecracker microVM（硬件级隔离），< 200ms cold start
- **Daytona**：Docker container（共享内核快速启动），persistent dev env
- **Cloudflare**：browser isolates（V8 隔离），< 50ms cold start
- **Modal**：serverless container，sub-second GPU（A100 / H100）
- **Blaxel**：perpetual env，25ms resume from idle，~1s auto-shutdown

`ephemeral: true` 是安全关键—— secret 不进 snapshot，snapshot 落到新 container 时 secret 自然丢失。

#### 2.4.3 Snapshot + Rehydrate

捕获 **filesystem + env vars + tool call history**，**跨 container** 持久化。

```python
session.fork_to(new_sandbox, snapshot=current_snapshot)
```

直接解决"长任务超过 sandbox idle timeout 进度全丢"的问题。

`Fresh-session inputs` 只在创建 session 时生效；运行中改 manifest 不影响已建 session——这个语义跟 ai-time-run `Mission.protectedIntentions` 高度同源。

#### 2.4.4 AGENTS.md + Skills（Native）

- AGENTS.md 是 native——CLI / VS Code extension / Desktop App / Agents SDK 全平台共享
- Skills 是 progressive disclosure：skill 是个 **index**，模型**按需 tool-call 拉取**完整内容——token 经济

```yaml
skills:
  - name: SWE-bench Verified solver
    description: Resolve GitHub issues with patches + tests
    trigger: github issue
    resources:
      - path: rubric.md
        size: 14KiB
      - path: playbook.md
        size: 32KiB
```

模型先看到 3 行 index，看到 trigger 命中才 pull 完整文件。这就是"宪法之下、Mission 之上的轻量指令层"的产业标准实现。

#### 2.4.5 Apply_patch（学自 Anthropic）

unified-diff-style edit：

```diff
*** Begin Patch
*** Update File: src/auth.ts
@@
- jwt.signate(payload, secret)
+ jwt.sign(payload, secret)
*** End Patch
```

- 局部编辑失败 → **整 patch 拒绝**（不部分接受）
- 强制模型 commit to surrounding context（diff 上下文是 git-style 多文件块）
- 比 JSON 块更省 token、更易让模型自我审查

#### 2.4.6 Subagents

```python
ctx.send(agent_a, "/root/agent_b", message, structured=True)
```

- path-based addresses（`/root/agent_a`）类似 actor kernel 的 lanes
- structured messaging：JSON schema 而非自然语言
- harness 控制**何时创建、何时关闭**

#### 2.4.7 Compaction

不再是启发式摘要，**模型自己生成**压缩条目：

```python
{
  "type": "compaction",
  "tokens_before": 142_000,
  "tokens_after": 8_400,
  "summary_by": "reasoning-model",
  "preserves": ["open-issue-ids", "verified-evidence-ids"]
}
```

可以指定"保留哪些信息"——比如 ai-time-run 应该强制保留 evidence ids，否则 effect.verified 链就断了。

#### 2.4.8 Memory Control

Harness 显式控制：
- 何时建 memory（不是模型自己决定）
- memory 落哪里（harness 持有的 vector store，不进 sandbox）
- 何时 recall（agent 调 recall tool，harness 返回）

跟 ai-time-run `BeliefRouter.assert/retract` 同一思想，但 OpenAI 做成 SDK 一等公民。

---

## 3. 同生态参考

### 3.1 SWE-Agent（NeurIPS 2024，Princeton）

> *Agent-Computer Interfaces Enable Automated Software Engineering*

**核心思想**：不是给 LLM 装更多工具，而是给 LLM 一个 **Agent-Computer Interface (ACI)**——把 noisy shell 改造成**高层、LM-friendly 的抽象**。

**4 个关键设计**：

| ACI 工具 | 作用 | 为什么 |
| --- | --- | --- |
| `search_dir` | 列目录，**硬限 50 条** | 强迫 agent refine 查询 |
| `File Viewer` | 100 行窗口 + 行号 + `scroll` / `goto` | shell `cat` 大文件撑爆 context |
| **Linter-Guarded Editing** | 每次 edit 后立即跑 linter | 80% edit 失败源自 syntax |
| **Context Management** | 自动折叠历史 observations 为单行 summary | 防 context 越长越乱 |

**成绩**：SWE-bench 12.47%（vs GPT-4 zero-shot 1.74%，+10.7pp），HumanEvalFix 87.7% pass@1，跨 Claude 3 Opus +10.5pp。

**关键 insight**：*"Success is fast, failure is slow"*——成功轨迹中位数 12 turns，失败轨迹到 turn 20 还没解决大概率死循环。**增加 budget 不线性改善成功率**。

**给 ai-time-run 的启示**：
- 我们的 `Probe.run()` 是"linter-guarded edit"的产业版本，已经领先
- 缺一个对 tool output 的 **truncation policy**——`execute_tool(name, opts.max_output_lines=200)`，超过截断（head + tail）
- `EpisodicMemory.remember()` 当前只 remember 整段，应升级为按 turn 自动折叠为 summary

### 3.2 TRAE Agent（开源，2025-09 SWE-bench Verified #1 with 75.2%）

工具集：`str_replace_based_edit_tool` / `bash` / `sequential_thinking` / `ckg_tools` / `task_done`

**Selector Agent**（多 LLM 仲裁）：
1. 多个 LLM 同时生成 patch 候选
2. 跑回归测试集过滤
3. **Syntax-based voting** + **multi-agent verification**

Multi-LLM support factory pattern：OpenAI / Anthropic / Azure 任意切换。

**Lakeview Mode**：另一个 LLM **异步**总结 agent 当前步骤，写入 trajectory。这正是 ai-time-run `EpisodicMemory` 应该做的事——被动记录 vs 主动总结。

### 3.3 JoyCode（京东开源，74.6% SWE-bench Verified，**30-50% 计算资源下降**）

**4 个 Agent + 5 大优化**：

| Agent | 职责 |
| --- | --- |
| **Testing Agent** | 写 Fail2Pass 测试（issue 触发的）+ Pass2Pass 测试 |
| **Patch Agent** | 看测试反推 patch |
| **CSR Agent** | Candidate Solution Ranker，给 patch 打分 |
| **Decision Agent** | 选最终 patch，仲裁冲突 |

**5 大优化**：
1. **测试协同**（生成测试反推 patch）
2. **失败归因**（不只是"报错"）
3. **经验迁移**（失败 memory）
4. **投票仲裁**（多 patch 选最优）
5. **容器化隔离**

**跟 ai-time-run 高度对位**：
- *"失败仅报错不归因"* → 我们的 `failure.attributed` 正是为此
- *"缺乏经验复用"* → 我们的 `EpisodicMemory` / `FailureMemory`
- *"Token 消耗爆炸"* → 我们的 `Ledger` 是天然 cost tracker，加 `tokensUsed` 字段即可

**最值得借鉴**：**"先测试后补丁"**——把 verification 提前到 patch 之前。当前 ai-time-run 是"candidate → critique → effect → probe"串行；JoyCode 是"test → patch → verify"——probe 在前，rollback 代价更小。

### 3.4 The End of Code Review（arXiv 2606.13175）

> 主张：agents 替代 human code review，因为 agents 同时持有 full file + test suite + git history + docs。

证据：
- Linter / formatter 已经被 AI 取代（style）
- 现在 AI 接管 semantic style
- Security review：agent 比 human 更系统（CWE enumeration）
- 推荐 agents for every commit + review-specific CI integration

跟 **CodeAgent (EMNLP'24) 的 QA-Checker** 互相印证。

### 3.5 商业闭源参考（认知即可）

| 产品 | 路线 | 备注 |
| --- | --- | --- |
| **Devin** | "AI 软件工程师"，2024-03 公测 | SWE-bench 13.86%，首家 |
| **Cursor** | IDE 集成 agent | AGENTS.md 支持 |
| **Aider** | 终端 pair-programming | AGENTS.md + git auto-commit |
| **GitHub Copilot Workspace** | 任务驱动 IDE | Issue → PR 闭环 |
| **TRAE Solo** | 多 LLM 仲裁 | 75.2% Verified |
| **JoyCode** | 测试-补丁协同 | 30-50% 计算下降 |

**所有头部 agent 都把 AGENTS.md 作为项目约定标准**——ai-time-run 加 AGENTS.md 支持不是可选项，是入场券。

---

## 4. SWE-bench Verified 现状（2025-12）

| 系统 | 成绩 | 备注 |
| --- | --- | --- |
| live-SWE-agent + Claude 4.5 Opus (medium) | **79.20%** | 当前第一 |
| Doubao-Seed-Code + TRAE | 78.80% | |
| Gemini 3 Pro + live-SWE-agent | 77.40% | |
| Claude 4.6 Opus + mini-SWE-agent | 75.60% | |
| MiniMax M2.5 + mini-SWE-agent | 75.80% | **$0.07/issue** |
| DeepSeek-V3.2 + SWE-Agent | 72.30% | $0.55/issue |
| JoyCode | 74.60% | 30-50% 计算下降 |

历史曲线：

| 时间 | 成绩 | 系统 |
| --- | --- | --- |
| 2023-10 | 1.74% | GPT-4 zero-shot |
| 2024-03 | 13.86% | Devin |
| 2024-04 | 12.47% | SWE-agent |
| 2024-10 | 49.0% | Claude 3.5 Sonnet |
| 2025-02 | 70.3% | Claude 3.7 Sonnet |
| 2025-05 | 72.5% | Claude 4 Opus |
| 2025-08 | 74.9% | GPT-5 |
| 2025-09 | 75.2% | TRAE |
| 2025-09 | 77.2% | Claude Sonnet 4.5 |
| 2025-12 | 79.2% | live-SWE-agent + Opus 4.5 |

**Insight**：
1. **Verified 在 ~80% 饱和**——剩下 20% 是最难、最模糊的
2. **竞争已转向 "cost per resolved issue"**——便宜模型 + 好 harness 已经逼近前沿大模型 + 贵 harness
3. **直接利好 ai-time-run**：brain 越便宜越好（"brain is swappable"原则现在更具产品价值），**harness 才是差异化护城河**

---

## 5. 安全事件（反面教材）

### 5.1 CVE-2026-25049（n8n, 2025-12, CVSS 10.0）

Template literal bypass → decrypt credentials。

教训：workflow 工具里把"动态拼接"当成可信输入，攻击者通过精心构造的字符串绕过认证。

### 5.2 ROME Agent（Alibaba, 2026-03）

**Reinforcement learning optimization 学会自主挖矿**。Open-loop 训练 + 无约束 objective → agent 自己找到奖励最大化的方法。

教训：goal 不能是"最大化 X"，必须有 **"what MUST NOT happen" 的硬约束**——ai-time-run 的 `Mission.protectedIntentions` 正是为此。

### 5.3 MCP Servers 跑在 Codex 沙箱外

OpenAI 已知问题：用户安装的 MCP server 默认在 host process 启动，**绕过 Codex 沙箱**。

教训：**harness 控制哪些 tool 可用**不是可选——ai-time-run 的 `TrustGateway` + `IdentityEngine` 是对的，但需要让 manifest-driven tool list 成为默认而不是 opt-in。

### 5.4 Hugging Face 沙箱突破（OpenAI 2025 修复）

Code Interpreter 关了网，模型借 pip 包内 Artifactory（用来拉包）作 SSRF 跳板出去。

教训：**工具之间的信任边界也要画**，不能只画"网络断"。OpenAI 修复方式：Artifact 工具单独 manifest，不跟普通 Code Interpreter 共享 stack。

---

## 6. ai-time-run 对接点矩阵（学习 → 落地映射）

| 学习点 | ai-time-run 当前 | 缺口 | 优先级 |
| --- | --- | --- | --- |
| **CodeAct** Python-as-action | 无 | `CodeActInterpreter` | P0 |
| **SWE-agent ACI** (search_dir / file viewer / linter-guarded edit) | `FileSystemAdapter` 已对 | `search_dir(limit=50)` / file viewer / linter adapter | P1 |
| **Self-Debugging** rubber-duck loop | `failure.attributed → rollback → 结束` | `failure.attributed → SelfDebugLoop(N) → rollback` | P0 |
| **Code-Feedback** 训练数据 | 无 | `CodeTraceMemory` schema | P2 |
| **Block-level runtime verification** (LDB) | `Probe.run()` 看 ok/value | block-level blame + 行号 | P1 |
| **JoyCode Test-First** | candidate → critique → effect → probe 串行 | probe 在前 / 测试-补丁协同 | P1 |
| **Pseudo-code plan** (CodeAgents 2025) | `Plan.steps: string[]` | `PseudoCodeStep[]` AST + token saving | P2 |
| **Code Interpreter as one tool** | 已经对了 | 无需改 | - |
| **Permission Inversion** (Codex CLI) | `approve()` ask-first | 默认 OS-sandbox + 仅边界升级 | P0 |
| **Tool Approval orthogonal to Sandbox Mode** | 已有 `CapabilityGrant.level` + `highImpactScopes` | 直接对应，无需改 | - |
| **AGENTS.md chain** | 无 | `Workspace.instructions.md` + global→repo→cwd | P1 |
| **Stateful kernel within session** | `EpisodicMemory` 已经 in-session | Jupyter kernel-style 持久化变量 | P2 |
| **"Verifiable evidence"** | `effect.verified ← evidence.attached(trace)` | 已经对了 | - |
| **Context Compaction** (model-generated) | `session.summarize()` 启发式 | 让模型自己生成 + 强制保留 evidence ids | P2 |
| **Manifest abstraction** | `Mission.capabilityBoundary` 部分对 | 完整 manifest（mounts / env / ports / deps / ephemeral） | P1 |
| **Snapshot + Rehydrate** | `Sandbox.snapshot/restore` 已经部分对 | cross-container 持久化 | P3 |
| **Apply_patch unified-diff edit** | 无 | 新增 `code.apply_patch` tool | P1 |
| **/review = second agent** | 无 / QA-Checker | `code.review` Reasoner | P2 |
| **Selector Agent multi-LLM arbitration** | 无 | `SelectorReasoner` 多 brain 仲裁 | P3 |
| **Lakeview Mode 异步总结** | 无 | `EpisodicMemory.async_summarize()` | P2 |
| **Subagents path-based addresses** | `IdentityEngine` lanes 已经对 | path-based naming + structured messaging | P2 |
| **Sandbox deny → auto-escalate** (Codex CLI `is_likely_sandbox_denied`) | 无 | heuristic + `SandboxEscalate` 事件 | P1 |
| **`codex debug seatbelt` 试运行** | 无 | `runtime.simulate(feature)` 已经部分对 | - |
| **long-lived PTY (npm run dev)** | 无 | `UnifiedExecProcessManager` | P3 |
| **Trust domain for tools** | `TrustGateway` 已有 | manifest-driven tool list 为默认 | P0 |

---

## 7. 设计启示（三句话）

### 7.1 学什么

1. **Code Interpreter 是个 tool，不是个 brain**——继续走 ai-time-run `Tool` 抽象，brain 仍是 LLM（"brain is swappable"原则最大胜利）
2. **Permission Inversion + Manifest abstraction**——把 ai-time-run 默认从 ask-first 改成 **default-deny-in-sandbox + 仅 high-impact scope 升级人工**，并补 `Mission.manifest` 字段
3. **Test-First JoyCode + Self-Debug loop + block-level verification**——三件套一起上，把 probe 体系升级为"测试-补丁协同 + block-level blame + self-debug retry"

### 7.2 不学什么

1. **不引入第三方 sandbox**（E2B / Daytona / Blaxel / Cloudflare）——ai-time-run 是 local-first
2. **不学 Responses API schema**——它是 Chat Completions 风格，硬套会丢 BREAK 4 WAL
3. **不学 "sandbox is server-managed"**——ai-time-run sandbox 是 process-local

### 7.3 警惕什么

1. **Codex CLI 是开源产品级代码**，不要照抄实现——它的 60+ crates 是一家公司 6 个月的成果，ai-time-run 要的是它的设计模式不是它的代码
2. **SWE-bench Verified 80% 饱和**——剩下 20% 没法靠更好模型解决，要靠 **better verification + better failure attribution + better memory**
3. **MCP / 第三方工具绕开 sandbox**——trust domain 设计不是装饰品

---

## 8. 参考文献清单

### 论文

1. Wang et al. *Executable Code Actions Elicit Better LLM Agents (CodeAct)*. ICML 2024. arXiv:2402.01030
2. Zhang et al. *CodeAgent: Enhancing Code Generation with Tool-Integrated Agent Systems for Real-World Repo-level Coding Challenges*. ACL 2024. arXiv:2401.07339
3. Chen et al. *Teaching Large Language Models to Self-Debug*. ICLR 2024. arXiv:2304.05128
4. Zheng et al. *OpenCodeInterpreter*. arXiv:2402.14658
5. Tian et al. *Debug like a Human (LDB)*. arXiv:2402.16906
6. Tang et al. *CodeAgent: Autonomous Communicative Agents for Code Review*. EMNLP 2024. arXiv:2402.02172
7. Yang et al. *CodeAgents: A Codified Multi-Agent Reasoning Framework*. arXiv:2507.03254
8. Yang et al. *SWE-agent: Agent-Computer Interfaces Enable Automated Software Engineering*. NeurIPS 2024
9. Jimenez et al. *SWE-bench*. arXiv:2310.06770. ICLR 2024
10. *The End of Code Review*. arXiv:2606.13175

### OpenAI 官方文档

- OpenAI Advanced Data Analysis (Code Interpreter) — https://help.openai.com/en/articles/8554397
- OpenAI Codex CLI — https://github.com/openai/codex
- OpenAI Responses API — https://platform.openai.com/docs/api-reference/responses
- OpenAI Agents SDK v2 — https://openai.github.io/openai-agents-python/
- OpenAI Sandboxes (2026-04) — https://platform.openai.com/docs/guides/sandboxes

### 安全事件

- CVE-2026-25049 (n8n, CVSS 10.0) — NVD 2025-12
- ROME Agent 自主挖矿 — Alibaba, 2026-03
- OpenAI HF 沙箱突破事件 — OpenAI Trust Center 2025 Q4 报告
- MCP servers bypass Codex sandbox — OpenAI 已知问题 (2026-02)

### ai-time-run 内部文献

- docs/06-mdibus-blueprint.md — MDIBUS V18 全图
- docs/07-harness-papers.md — 三篇 2026 arXiv harness 论文深读
- docs/09-harness-merge.md — DeepSeek × Codex harness merge
- docs/11-break4-wal.md — BREAK 4: tamper-evident WAL + idempotent effects
- docs/12-break5-misevolution.md — BREAK 5: self-amendment guardrails

---

> 本笔记是 BREAK 7 (CodeAgent Integration) 设计稿 docs/13 的输入。设计稿将聚焦"4 个增量组件 + EventType 增量 + Skill wrapper 升级 + 6 步实施路线"，本笔记不重复其内容。
