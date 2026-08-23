# AI Time Run

> Managed Agent Runtime: decouple the brain from the hands, and make every
> step auditable through a single event-sourced Session.

AI Time Run 是一个面向长周期自主智能体的运行时，吸收 Anthropic 的 Harness 工程
源头，把 `Planner - Generator - Evaluator - Critic` 多智能体对抗闭环、大脑/手脚
解耦、宪法对齐和事件溯源统一到一条追加式事实账本上。

## 技术突破

现有的 Agent 运行时大多把“模型循环、工具执行、权限、校验”分开实现。AI Time Run
的突破点是把它们收拢到四个可独立部署的组件，并用一条 Session 账本贯穿：

- `Session`：追加式事件账本，独立于模型上下文窗口，可重放、切片、回退。
- `Harness`：编排中枢，运行 Planner-Generator-Evaluator-Critic 对抗闭环。
- `Sandbox`：手脚工具执行，故障隔离、能力边界、快照回滚，与大脑彻底解耦。
- `Orchestration`：任务分解、权限门、审批门、效应校验与信念路由。

三条机制性不变量：

- `NO_PASS_WITHOUT_VERIFICATION`：功能没有探测证据，不能被标为通过。
- `NO_EFFECT_WITHOUT_AUTHORITY`：没有能力授权，不允许发起副作用。
- `NO_CLAIM_WITHOUT_EVIDENCE`：模型输出只是主张，只有被观察证据支持后才可信。

这些不变量由 `validateLedger` 强制检查，任何伪造的“通过”或“已验证”事件都会被拒绝。

## MDIBUS 血缘

本实现以 `MDIBUS-Runtime Architecture V18` 的九模块为蓝本，保留
`State-Evidence-Authority-Coordination` 范式，并在三处做了创新：

- 反事实模拟认知层：先模拟、后执行，副作用在真实世界中隔离。
- 因果历史与隔离图：把 `atomic/parallel` 与依赖关系变成可审计的事实。
- 语义信任网关：不可信内容不能改变信任，只有可信证据才能翻转状态。

完整九模块映射见 [docs/05-mdibus-mapping.md](docs/05-mdibus-mapping.md)。

## 四篇核心论文

| 论文 | 作者 | 吸收的机制 |
| --- | --- | --- |
| Effective harnesses for long-running agents | Anthropic 2025-11 | Initializer/Coding 分工、默认失败功能清单、跨会话持久工件 |
| Harness design for long-running application development | Anthropic 2026-03 | Planner-Generator-Evaluator 对抗 Harness、sprint 迭代 |
| Scaling Managed Agents: Decoupling the brain from the hands | Anthropic 2026-04 | Session/Harness/Sandbox/Orchestration 四组件、大脑手脚解耦 |
| Constitutional AI: Harmlessness from AI Feedback | Anthropic 2022 | 模型自我批判-修正闭环，嵌入证据-校验层 |

完整论文合集与补充技术博客见 [docs/01-papers.md](docs/01-papers.md)，架构细节见
[docs/03-managed-agent-runtime.md](docs/03-managed-agent-runtime.md)。

## 工作流

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

四组件架构图与多智能体握手时序图见
[docs/04-workflow-diagram.md](docs/04-workflow-diagram.md)。

## 快速开始

```bash
npm install
npm run build
npm run demo
npm test
```

`demo` 会跑四个功能，分别演示：授权成功、审批门放行、越权拒绝、审批拒绝，并触发一次
宪法修订环。

## 项目结构

| 路径 | 职责 |
| --- | --- |
| `src/ledger.ts` | 追加式事件账本 |
| `src/project.ts` | 从事件重建当前状态 |
| `src/session.ts` | 会话重放、切片、摘要 |
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
