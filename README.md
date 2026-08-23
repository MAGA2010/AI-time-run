# AI Time Run

> Managed Agent Runtime: decouple the brain from the hands, and make every
> step auditable through a single event-sourced Session.

AI Time Run 是一个面向长周期自主智能体的运行时。它吸收 Anthropic 的 Harness
工程源头与 OpenAI 的治理实践，把 `Planner - Generator - Evaluator - Critic`
多智能体对抗闭环、大脑/手脚解耦、宪法对齐和事件溯源统一到一条追加式事实账本上。

## 定位

AI Time Run 解决的不是“如何让模型更聪明”，而是长周期 Agent 最难的两个工程问题：

- 跨上下文窗口的进度交接与状态持久化。
- “谁、在什么证据、什么权限下、产生了什么效应”的可审计与可恢复。

为此，它把整个运行时拆成四个可独立部署的组件，并用一条 Session 账本贯穿。

## 核心创新

1. **反事实模拟认知层**：先模拟、后执行。`Simulator` 在沙盒里快照、执行、再回滚，
   把“如果这样做会怎样”写成 `simulation.recorded`，真实世界零副作用。
2. **因果历史与隔离图**：`CausalGraph` 从事件 `parent` 重建显式 DAG，`classifyEffect`
   把高影响副作用标为 `atomic`（不可中断），其余标为 `parallel`（可并行）。
3. **语义信任网关**：`TrustGateway` 强制“不可信内容不能改变信任”。只有可信来源
   且 `ok` 的证据才能翻转功能、信念或权限。

## 核心范式

AI Time Run 遵循 `State-Evidence-Authority-Coordination` 四个范式。

| 范式 | 含义 | 落点 |
| --- | --- | --- |
| State | 状态必须能从事件日志重建 | `Ledger + project` |
| Evidence | 模型输出只是主张，被观察后才成证据 | `Claim / Evidence / Belief` |
| Authority | 权限是可执行数据，会话撤销连带权限失效 | `AuthorityEngine` |
| Coordination | 多智能体通过角色、车道、因果链协同 | `Planner/Generator/Critic/Evaluator` |

## 四大组件

| 组件 | 职责 | 实现 |
| --- | --- | --- |
| Session | 追加式事件账本，重放/切片/摘要 | `ledger.ts`、`session.ts` |
| Harness | 编排中枢，多智能体对抗闭环 | `orchestrator.ts` |
| Sandbox | 手脚工具执行，故障隔离，快照恢复 | `sandbox.ts` |
| Orchestration | 调度、权限、审批、监督、信念路由 | `authority.ts`、`oversight.ts`、`memory.ts` |

## MDIBUS V18 九模块蓝图

```mermaid
flowchart TB
  subgraph M01["01 Principal + Mission 主体与任务"]
    direction TB
    P0["Human / Principal<br/>intent-contract-judgement"]
    RB1["Resource / Boundary<br/>norm-constraints · authority-boundaries · mandate-scope"]
    PI["Protected Intentions<br/>no-override · no-rewrite-back · delegated-beliefs"]
    CL["Compulsion Log<br/>authority-delegation / constraint-log"]
  end

  subgraph M02["02 Cognitive Services 认知服务"]
    direction TB
    OM["OMEGA / Simulation<br/>counterfactual + alt-world-models"]
    PL["Planning Service<br/>situation-awareness · Δ-Q · Δ-state"]
    OB["Observer-Monitor<br/>context → evidence-stream"]
    SB0["Sandboxed<br/>capability-reliability-cost-variance"]
    CC["Control Compiler<br/>semantic-spec → transcript → dialect"]
  end

  subgraph M03["03 MDIBUS Kernel 事件溯源语义内核"]
    direction TB
    RT["Retainer<br/>external-input-wins · determinism-when-safe"]
    DG["Dependency / Insulation Graph<br/>causal-observability · atomic-vs-parallel"]
    ISO["Isolation<br/>authority-isolation-enforcer"]
    CHK["Causal-History-Kernel<br/>construction-evidence-reputation"]
    EVL["Evidence Logger<br/>provenance · fact-check · trace-archive"]
    CLL["Claim Logger<br/>author-output-claim-not-truth"]
    CS["Conjecture Scheduler<br/>information-gap-hypothesis"]
    BC["Belief Consumer<br/>counterfactual-belief-blips"]
    APE["Authority-Policy-Engine<br/>delegation-rules-as-data"]
  end

  subgraph M04["04 Actor Kernel 多智能体协同"]
    direction TB
    LN["Lanes / Ownership<br/>reply-only · lifecycle-handshake"]
    ID["Identity Engine<br/>model-container-trust-domain"]
    TD["Trigger / Dispatch<br/>MDIBus-Events-producer-consumer"]
    GC["Goal Conflict Resolver<br/>clash-tolerate-down-modulate"]
    CSP["Coordinated-State-Population<br/>normative-op · retry"]
    ASB["ANKET-EVICTION-SLOT-ALLOC-BLOCKER"]
    IM["Identity Monitor<br/>alter-validate-local-state"]
    EAA["External-Agent-Adapter<br/>bounded-delegation-contract"]
    MS["Model State<br/>Copy-On-Write · delta-only-fork"]
  end

  subgraph M05["05 Capability + Session Fabric 能力与会话"]
    direction TB
    STG["Semantic-Trust Gateway<br/>untrusted-cannot-mutate-trust"]
    PSM["Precedent-Session Manager<br/>session-bound-grant · revoke-all"]
    AD["Abstraction Detector<br/>interface-bound-level"]
    EA["Evidence Arbiter<br/>truth-quality-reporter"]
    PPE["permission-provision-effects-observations"]
    ECC["Embedded-Capability-Crash<br/>fault-isolation-session-kill"]
  end

  subgraph M06["06 Environments / World 环境与外部世界"]
    direction TB
    DT["Determinism<br/>doable-task-ground-truth"]
    PHY["Physical / Robotics<br/>high-latency-real-world"]
    API["API / Web / Cloud / CRUD<br/>deterministic-where-possible"]
    DVS["Dvs / Adevait-semantic-wrappers"]
    BR["Browser<br/>DOM-AX-screen-read"]
    SH["Shell / Process / PTY"]
    BD["Boundary<br/>diff-history-commit"]
    FS["Filesystem<br/>real-write-watch"]
  end

  subgraph M07["07 Effect + Verification Loop 执行校验闭环"]
    direction TB
    CR["Checkpoint-Recovery<br/>commit-request-rollback"]
    VRO["verified-effect-requested-output<br/>until-report-never-enough"]
    AA["Actualized-Action<br/>verified-requested-effect"]
    VP["Verification-Probe<br/>observer-deterministic-check"]
    EVD["Effect-Validator<br/>difference-asserted-performance"]
  end

  subgraph M08["08 Workspace + Durable Memory 工作区与持久记忆"]
    direction TB
    PJ["Programmed Journal<br/>progress-checkpoint"]
    AS["Artifact Store<br/>code-reports-requirement-traces"]
    FML["Failure-Memory-log<br/>failure-operation-history"]
    EM["Episodic-Memory<br/>task-episode-retrospection"]
    FCM["Failure/Campaign-Memory"]
    BRR["Belief-Router<br/>pub-sub-fact-link-tombstones"]
    SW["Selective-Workspace<br/>hard-constraints-blacklists-context-window"]
  end

  subgraph M09["09 Eval + Human Oversight 评估与人机监督"]
    direction TB
    RF["Reliability / Failure Metrics<br/>success-risk-cost-threshold"]
    ACE["Advanced Control Edits<br/>reconfigure-selective-verify"]
    MBS["Monitor-Blind-Spot<br/>state-log-heap-calibration"]
    BEL["Belief-Eval-Lab<br/>hypothesis-vs-reality"]
    RE["Refusing-Evaluation<br/>classify-fail-e2e-confidence"]
    SA["Safeguard-4-Access<br/>interrupt-modulate-intrusion"]
    MDL["Mission-Download<br/>pause-preserve-risk"]
  end

  M01 --> M02 --> M03 --> M04 --> M05 --> M06 --> M07 --> M08
  M08 -.->|"evidence / memory feedback"| M02
  M09 -.-> M01
  M09 -.-> M03
  M09 -.-> M04
  M09 -.-> M05
  M09 -.-> M07
  M09 -.-> M08
```

## 运行时主循环

```mermaid
flowchart TB
  subgraph L0["00 Principal 主体"]
    P0["Principal 人<br/>意图契约 · 能力边界<br/>protected intentions"]
  end

  subgraph L1["01 Mission 任务授权"]
    P0 -->|"mission.created"| M1["Mission<br/>goal / boundary / threshold"]
  end

  subgraph L2["02 Initializer 初始化"]
    M1 --> I1["Initializer<br/>feature.registered · 默认 fails<br/>progress + init commit"]
  end

  subgraph L3["03 Session 会话检查"]
    I1 --> S1{"Session 状态"}
  end

  S1 -->|"shutdown.requested"| DONE["结束"]
  S1 -->|"上下文耗尽"| CMP["compact + summarize"]
  CMP --> S1
  S1 -->|"还有未通过功能"| PL1
  S1 -->|"全部通过"| DONE

  subgraph L4["04 Planner 规划"]
    PL1["Planner<br/>plan.recorded<br/>选择功能 + 步骤"]
    PL1 -->|"claim.recorded"| PL2["Claim 主张<br/>作者输出，不是真相"]
  end

  subgraph L5["05 Generator 生成"]
    PL2 --> G1["Generator<br/>candidate.proposed"]
  end

  subgraph L6["06 Critic 宪法批判"]
    G1 --> C1{"Critic / Constitution<br/>critique.recorded<br/>符合全部原则?"}
    C1 -->|"否"| RX{"修订次数<br/>< maxRevisions?"}
    RX -->|"是"| RV["revision.requested"]
    RV --> G1
    RX -->|"否"| REJ["constitution-rejected"]
  end

  subgraph L7["07 Authority 权限门"]
    C1 -->|"是"| A1{"Authority.canAct<br/>act 级授权?"}
    A1 -->|"无授权"| NGA["no-capability-grant"]
    A1 -->|"授权已撤销"| RVK["revoked-grant"]
    A1 -->|"级别不足"| LVL["insufficient-level"]
    A1 -->|"已授权"| HI{"高影响 scope?"}
    HI -->|"低影响"| EF
    HI -->|"高影响"| AP{"Human Approval Gate"}
    AP -->|"approval.denied"| ADN["approval-denied"]
    AP -->|"approval.granted"| EF
  end

  subgraph L8["08 Sandbox 手脚执行"]
    EF["effect.requested"] --> CK["checkpoint.created<br/>保存世界快照"]
    CK --> TO{"工具存在?"}
    TO -->|"否"| MTO["missing-tool"]
    TO -->|"是"| SB{"Sandbox.execute<br/>故障隔离"}
    SB -->|"异常"| RB["rollback.requested<br/>effect.reverted"]
    SB -->|"成功"| EA["effect.actualized"]
  end

  subgraph L9["09 Evaluator 客观校验"]
    EA --> PR{"probe 存在?"}
    PR -->|"否"| MPR["missing-probe"]
    PR -->|"是"| EV["runProbe -> evidence.attached"]
    EV -->|"证据失败"| RB
    EV -->|"证据通过"| TR{"trust.assessed<br/>可信?"}
    TR -->|"不可信"| RB
    TR -->|"可信"| EG{"evaluation.recorded<br/>评估通过?"}
    EG -->|"否"| RB
    EG -->|"是"| VF["effect.verified"]
  end

  subgraph L10["10 Commit 提交"]
    VF --> FU["feature.updated<br/>passes=true + evidenceId"]
    FU --> BL["belief.asserted"]
    BL --> MEM["progress + episodic<br/>artifacts + beliefs"]
  end

  MEM --> S1

  subgraph L11["11 Oversight 监督盲区"]
    OV["Oversight<br/>metrics · blindSpots<br/>approval gates · shutdown"]
  end

  OV -.-> PL1
  OV -.-> A1
  OV -.-> PR
  OV -.-> VF
  OV -.-> DONE
  REJ -.-> OV
  NGA -.-> OV
  RVK -.-> OV
  LVL -.-> OV
  ADN -.-> OV
  MTO -.-> OV
  MPR -.-> OV
  RB -.-> OV

  classDef state fill:#fff7ed,stroke:#ea580c,color:#7c2d12;
  classDef gate fill:#eff6ff,stroke:#2563eb,color:#1e3a8a;
  classDef write fill:#f0fdf4,stroke:#16a34a,color:#14532d;
  classDef fail fill:#fef2f2,stroke:#dc2626,color:#7f1d1d;
  classDef warn fill:#fffbeb,stroke:#d97706,color:#78350f;
  class M1,PL2,MEM,BL state;
  class S1,C1,RX,A1,HI,AP,TO,SB,PR,TR,EG gate;
  class I1,PL1,G1,EF,CK,EA,EV,RV,VF,FU write;
  class REJ,NGA,RVK,LVL,ADN,MTO,MPR,RB fail;
  class CMP,DONE warn;
```

## 多智能体角色

| 角色 | 职责 | 写入的事件 |
| --- | --- | --- |
| Principal | 定义意图、能力边界，行使审批与停机 | `mission.created`、`approval.*`、`shutdown.requested` |
| Initializer | 初始化环境，登记默认失败的功能清单 | `feature.registered` |
| Planner | 选择功能、分解步骤、产出计划与主张 | `plan.recorded`、`claim.recorded` |
| Generator | 产出候选实现，经宪法修订后交给沙盒 | `candidate.proposed`、`effect.requested` |
| Critic | 按宪法原则批判候选，触发修订 | `critique.recorded`、`revision.requested` |
| Evaluator | 运行探测、采集证据、做客观评估 | `evidence.attached`、`evaluation.recorded`、`effect.verified`、`feature.updated` |
| Observer | 提供外部环境观测与信任判定 | `trust.assessed` |

## 事件模型

所有事件追加到 `Ledger`，每条事件包含：
`id / seq / at / type / actor / payload / parent / evidence`。

| 事件 | 含义 |
| --- | --- |
| `mission.created` | 主体意图契约与能力边界 |
| `feature.registered` | 默认失败的测试契约 |
| `plan.recorded` | 规划者产出的计划 |
| `claim.recorded` | 作者主张，不是真相 |
| `candidate.proposed` | 生成器候选 |
| `critique.recorded` | 批判者审查 |
| `revision.requested` | 宪法修订请求 |
| `grant.issued` / `grant.revoked` | 能力授权与撤销 |
| `approval.granted` / `approval.denied` | 人工审批门 |
| `effect.requested` / `actualized` / `verified` / `reverted` | 副作用生命周期 |
| `checkpoint.created` / `rollback.requested` | 可逆性 |
| `evidence.attached` | 探测证据 |
| `evaluation.recorded` | 评估者结论 |
| `trust.assessed` | 信任判定 |
| `simulation.recorded` | 反事实模拟 |
| `conjecture.recorded` / `conjecture.resolved` | 猜想调度 |
| `belief.asserted` / `belief.retracted` | 信念与墓碑 |
| `feature.updated` | 只有带证据才能翻转 |
| `shutdown.requested` | 停机 |

## 不变量

`validateLedger` 在日志层面强制三条机制性不变量，并拒绝伪造事件：

1. `NO_PASS_WITHOUT_VERIFICATION`：`feature.updated` 的 `passes: true` 必须引用 `ok: true` 的证据。
2. `NO_EFFECT_WITHOUT_AUTHORITY`：`effect.requested` 必须存在未撤销的 `act` 级授权。
3. `NO_CLAIM_WITHOUT_EVIDENCE`：模型输出先记为 `Claim`，只有被证据支持后才可信。

此外还检查序号连续（追加完整性）与因果父链（`effect.actualized` 必须指向
`effect.requested`）。

## 权限与审批

- 能力授权是数据：`grant.issued` 记录 actor、scope、level（read/act/oversee）。
- 撤销是墓碑：`grant.revoked` 不删除历史，只标记失效。
- 高影响 scope 在 `effect.requested` 前必须经过 `approval.granted`。
- `canAct` 先查授权，再查审批门，缺失任一层都会拒绝并给出明确原因。

## 沙盒与故障隔离

- `Sandbox.execute` 捕获工具异常，返回 `{ ok: false, error }` 而不是抛出。
- 每次副作用前写入 `checkpoint.created`，失败时 `rollback.requested` 后用快照恢复。
- 大脑（`Reasoner`）与手脚（`Tool`）彻底解耦，模型故障不影响工具状态。

## 宪法对齐

`Constitution` 把原则作为数据，`Critic` 对每个候选逐条审查。不符合时请求修订，
达到 `maxRevisions` 仍不符合则拒绝。这对应 Constitutional AI 的“自我批判-修正”闭环。

## 记忆系统

| 记忆 | 职责 |
| --- | --- |
| `ProgressJournal` | 跨会话进度日志 |
| `ArtifactStore` | 代码、报告、需求追踪 |
| `EpisodicMemory` | 任务片段与复盘 |
| `FailureMemory` | 失败操作历史 |
| `BeliefRouter` | 信念发布/撤回，撤回用墓碑 |

## 监督与盲区

`Oversight` 计算通过率、计划/候选/批判/修订数、效应与信念统计，并检测盲区：
任何“通过但缺少证据、计划或批判”的功能都会被上报。监督不仅监控 Agent，
也监控监控器本身。

## 四篇核心论文

| 论文 | 作者 | 吸收的机制 |
| --- | --- | --- |
| Effective harnesses for long-running agents | Anthropic 2025-11 | Initializer/Coding 分工、默认失败功能清单、跨会话持久工件 |
| Harness design for long-running application development | Anthropic 2026-03 | Planner-Generator-Evaluator 对抗 Harness、sprint 迭代 |
| Scaling Managed Agents: Decoupling the brain from the hands | Anthropic 2026-04 | Session/Harness/Sandbox/Orchestration 四组件、大脑手脚解耦 |
| Constitutional AI: Harmlessness from AI Feedback | Anthropic 2022 | 模型自我批判-修正闭环 |

## 快速开始

```bash
npm install
npm run build
npm run demo
npm test
```

`demo` 会跑四个功能，分别演示：授权成功、审批门放行、越权拒绝、审批拒绝，并触发
一次宪法修订环。预期输出包含 `45 events, VALID`、`plans 4 / candidates 5 /
critiques 5 / revisions 1`、`beliefs 2`、`blind spots: none`。

## CLI 用法

```bash
ai-time-run demo                 # 内存运行演示
ai-time-run demo --store ./data  # 持久化到 ./data/ledger.jsonl
```

## 项目结构

| 路径 | 职责 |
| --- | --- |
| `src/ledger.ts` | 追加式事件账本 |
| `src/project.ts` | 从事件重建当前状态 |
| `src/session.ts` | 会话重放、切片、摘要 |
| `src/causal.ts` | 因果历史与隔离图 |
| `src/cognition.ts` | 反事实模拟、观测桥、猜想调度 |
| `src/trust.ts` | 语义信任网关 |
| `src/sandbox.ts` | 手脚工具执行与故障隔离 |
| `src/constitution.ts` | 宪法原则与批判 |
| `src/actors.ts` | 角色与可插拔 Reasoner |
| `src/authority.ts` | 能力授权与审批门 |
| `src/evidence.ts` | 主张与证据 |
| `src/verification.ts` | 探测与校验 |
| `src/memory.ts` | 进度、情景、失败、信念路由 |
| `src/oversight.ts` | 指标与盲区检测 |
| `src/invariants.ts` | 日志级不变量校验 |
| `src/orchestrator.ts` | ManagedRuntime 编排器 |
| `src/demo.ts` | 自包含演示场景 |
| `tests/` | 不变量与回路测试 |

## 文档索引

| 文档 | 内容 |
| --- | --- |
| [01-papers.md](docs/01-papers.md) | 论文与技术博客合集 |
| [02-architecture.md](docs/02-architecture.md) | 早期架构说明 |
| [03-managed-agent-runtime.md](docs/03-managed-agent-runtime.md) | 四大组件与多智能体闭环 |
| [04-workflow-diagram.md](docs/04-workflow-diagram.md) | 完整流程图、组件图、时序图 |
| [05-mdibus-mapping.md](docs/05-mdibus-mapping.md) | MDIBUS 九模块映射 |
| [06-mdibus-blueprint.md](docs/06-mdibus-blueprint.md) | MDIBUS V18 完整蓝图 |

## 设计原则

- 简单优先：先用确定性 `Reasoner` 跑通闭环，再替换真实模型。
- 证据优先：不信任模型自述，只信任探测证据。
- 可逆优先：副作用前检查点，失败可回滚。
- 透明优先：每一步都写入事件账本，可重放、可审计。

## 路线图

- `Identity Engine`：模型/容器/信任域身份绑定与选择性握手。
- `Goal Conflict Resolver`：多目标冲突检测与权限下调。
- `External-Agent-Adapter`：有边界的跨 Agent 委托契约。
- `Copy-On-Write Model State`：delta-only fork 隔离。
- `Belief-Eval-Lab`：假设模拟与现实对比。
- `Browser / Shell / API`：真实环境适配器与确定性建模。

## 常见问题

**为什么不用 LLM 框架？**
运行时与推理解耦，`Reasoner` 是唯一需要接模型的接口，便于替换和测试。

**账本会无限增长吗？**
账本是追加式的，`Session.slice` 可以按类型/角色/数量切片，`compact` 可做摘要压缩。

**撤销授权会删除历史吗？**
不会，`grant.revoked` 与 `belief.retracted` 都是墓碑，历史始终可追溯。

## License

MIT
