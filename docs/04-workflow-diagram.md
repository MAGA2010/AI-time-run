# 完整工作流大图（BREAK 7 升级版）

下面是 Managed Agent Runtime 的完整执行图。为了看清每个角色、每条事件和每
个回环，它有意画得比较重：实线是主链路，虚线是监督与反馈。

> **BREAK 7 标注**：图中标 **黄底（#facc15）** 的节点是 CodeAgent 集成
> 新增的环节（`code.*` 事件 / CodeAct kernel / SelfDebugLoop / QA-Checker
> / sandbox heuristic）。如果只看基础 managed-agent 路径，可忽略这些。

---

## 1. 运行时主循环（含 BREAK 7）

```mermaid
flowchart TB
  subgraph L0["00 Principal 主体"]
    P0["Principal 人<br/>意图契约 · 能力边界<br/>protected intentions"]
  end

  subgraph L1["01 Mission 任务授权"]
    P0 -->|"mission.created<br/>+ manifest ⭐"| M1["Mission<br/>goal / boundary / threshold<br/>manifest: mounts/env/ports/deps"]
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
    PL1["Planner<br/>plan.recorded<br/>选择功能 + 步骤<br/>⭐ PseudoCodeStep AST"] -->|"claim.recorded"| PL2["Claim 主张<br/>作者输出，不是真相"]
  end

  subgraph L5["05 Generator 生成"]
    PL2 --> G1["Generator<br/>candidate.proposed"]
  end

  subgraph L6["06 Critic 宪法批判 ⭐QA-Checker"]
    G1 --> C1{"Critic / Constitution<br/>critique.recorded<br/>符合全部原则?"}
    C1 -->|"否"| RX{"修订次数<br/>< maxRevisions?"}
    RX -->|"是"| RV["revision.requested"]
    RV --> G1
    RX -->|"否"| REJ["constitution-rejected"]
    C1 -->|"是"| QAV{"⭐ QA-Checker<br/>on_topic + alignment<br/>> minAlignment?"}
    QAV -->|"否"| RX
    QAV -->|"是"| A1
  end

  subgraph L7["07 Authority 权限门"]
    A1{"Authority.canAct<br/>act 级授权?"}
    A1 -->|"无授权"| NGA["no-capability-grant"]
    A1 -->|"授权已撤销"| RVK["revoked-grant"]
    A1 -->|"级别不足"| LVL["insufficient-level"]
    A1 -->|"已授权"| HI{"高影响 scope?"}
    HI -->|"低影响"| EF
    HI -->|"高影响"| AP{"Human Approval Gate"}
    AP -->|"approval.denied"| ADN["approval-denied"]
    AP -->|"approval.granted"| EF
  end

  subgraph L8["08 Sandbox 手脚执行 ⭐CodeAct"]
    EF["effect.requested<br/>⭐ code.repl | code.apply_patch | ..."] --> CK["checkpoint.created<br/>保存世界快照"]
    CK --> TO{"工具存在?"}
    TO -->|"否"| MTO["missing-tool"]
    TO -->|"是"| SB{"Sandbox.execute<br/>故障隔离"}
    SB -->|"异常"| RB["rollback.requested<br/>effect.reverted"]
    SB -->|"成功"| EA["effect.actualized<br/>⭐ Jupyter kernel stateful"]
  end

  subgraph L9["09 Evaluator 客观校验 ⭐Block-level"]
    EA --> PR{"probe 存在?"}
    PR -->|"否"| MPR["missing-probe"]
    PR -->|"是"| EV["runProbe -> evidence.attached<br/>⭐ block_blame? file:startLine:endLine"]
    EV -->|"证据失败"| SDL{"⭐ SelfDebugLoop<br/>attempt < maxAttempts?"}
    SDL -->|"是"| SDP["⭐ code.feedback<br/>⭐ code.retry<br/>rubber-duck refinement"]
    SDP --> EF
    SDL -->|"否"| RB
    EV -->|"证据通过"| TR{"trust.assessed<br/>可信?"}
    TR -->|"不可信"| RB
    TR -->|"可信"| EG{"evaluation.recorded<br/>评估通过?"}
    EG -->|"否"| RB
    EG -->|"是"| VF["effect.verified"]
  end

  subgraph L10["10 Commit 提交"]
    VF --> FU["feature.updated<br/>passes=true + evidenceId<br/>⭐ via: self-debug?"]
    FU --> BL["belief.asserted"]
    BL --> MEM["progress + episodic<br/>artifacts + beliefs<br/>⭐ CodeTraceMemory"]
  end

  MEM --> S1

  subgraph L11["11 Oversight 监督盲区 ⭐SandboxEscalate"]
    OV["Oversight<br/>metrics · blindSpots<br/>⭐ isLikelySandboxDenied<br/>→ code.escalate"]
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
  SDL -.-> OV

  classDef state fill:#fff7ed,stroke:#ea580c,color:#7c2d12;
  classDef gate fill:#eff6ff,stroke:#2563eb,color:#1e3a8a;
  classDef write fill:#f0fdf4,stroke:#16a34a,color:#14532d;
  classDef fail fill:#fef2f2,stroke:#dc2626,color:#7f1d1d;
  classDef warn fill:#fffbeb,stroke:#d97706,color:#78350f;
  classDef break7 fill:#facc15,stroke:#a16207,color:#713f12,stroke-width:2px;

  class M1,PL2,MEM,BL state;
  class S1,C1,RX,QAV,A1,HI,AP,TO,SB,SDL,PR,TR,EG gate;
  class I1,PL1,G1,EF,CK,EA,EV,RV,VF,FU write;
  class REJ,NGA,RVK,LVL,ADN,MTO,MPR,RB fail;
  class CMP,DONE warn;

  %% BREAK 7 黄底标注（CodeAgent 集成新增）
  class PL1,QAV,EA,EV,SDL,SDP,FU,MEM,OV break7;
```

---

## 2. BREAK 7 CodeAgent 子回路（黄底高亮）

下面这张图专门画 BREAK 7 的核心创新——`code.repl` 的失败不再直接回滚，而是
进入 `SelfDebugLoop` 循环。每一轮都把 brain 的解释 / 修订 / 执行结果写到
ledger，让 reviewer 能完整还原 "模型说过什么 vs kernel 实际做了什么"。

```mermaid
flowchart TB
  subgraph CELL["⭐ CodeAct Kernel (per-feature)"]
    direction TB
    KP["Python subprocess<br/>stateful GLOBALS<br/>Jupyter-wire protocol"]
    EX["exec(compile(code, cell, exec), GLOBALS)<br/>redirect_stdout + redirect_stderr"]
    KP --> EX
  end

  subgraph TOOLS["⭐ CodeToolSet (5 tools)"]
    direction LR
    T1["code.search<br/>rg --json<br/>scope: repo.read"]
    T2["code.symbol_nav<br/>⭐ 最高优先级<br/>def + refs<br/>scope: repo.read"]
    T3["code.doc<br/>docstring + sig<br/>scope: repo.read"]
    T4["code.format<br/>prettier --check<br/>scope: repo.read"]
    T5["code.apply_patch<br/>unified-diff<br/>scope: repo.write<br/>atomic rollback"]
  end

  subgraph SDL["⭐ SelfDebugLoop"]
    direction TB
    S0["failure.attributed<br/>block_blame: file:line"]
    S1["attempt 1<br/>reasoner.explain()"]
    S2["⭐ code.feedback<br/>explanation + prevTrace"]
    S3["⭐ effect.requested<br/>scope: sandbox.exec"]
    S4["kernel.executeCell(refinement)<br/>⭐ code.executed"]
    S5["⭐ evidence.attached<br/>source: code.cell.ok<br/>ok = rc==0<br/>block_blame?"]
    S6{"ok &&<br/>successProbe?"}
    S7["⭐ code.retry<br/>attempt=1, success=true"]
    S8["feature.updated<br/>passes=true<br/>via: self-debug"]
    S9["⭐ code.retry<br/>attempt=1, success=false<br/>next attempt → S1"]
    S0 --> S1 --> S2 --> S3 --> S4 --> S5 --> S6
    S6 -->|"是"| S7 --> S8
    S6 -->|"否"| S9 --> S1
    S9 -.->|"attempt >= max"| RB["rollback.requested<br/>effect.reverted"]
  end

  subgraph HUB["⭐ isLikelySandboxDenied"]
    direction TB
    HD["tool output<br/>error / stderr / stdout"]
    HE["concat + grep<br/>SIGNALS = Operation not permitted<br/>Permission denied | seatbelt<br/>Landlock | bwrap | seccomp"]
    HO{"match?"}
    HE1["⭐ code.escalate<br/>suggested: danger-full-access"]
    HD --> HE --> HO
    HO -->|"是 + scope∈exec/write/fs"| HE1
    HO -->|"否"| HO2["keep-policy"]
  end

  CELL --> SDL
  TOOLS --> CELL
  HUB -.->|"升级授权"| SDL

  classDef break7 fill:#facc15,stroke:#a16207,color:#713f12,stroke-width:2px;
  classDef kernel fill:#fef9c3,stroke:#ca8a04,color:#713f12;
  classDef warn fill:#fffbeb,stroke:#d97706,color:#78350f;
  classDef fail fill:#fef2f2,stroke:#dc2626,color:#7f1d1d;

  class KP,EX kernel;
  class S2,S3,S4,S5,S7,S9,HE1,RB break7;
  class HO2 warn;
  class HD,HE,HO,S0,S1,S6,S8,S9 kernel;
  class T1,T2,T3,T4,T5 kernel;
```

---

## 3. 四组件架构（含 CodeAct 作为第六个 Environment）

```mermaid
flowchart LR
  subgraph Session["Session 账本"]
    SG["ledger.jsonl<br/>append-only<br/>replay · slice · summarize<br/>⭐ code.* events 高亮"]
  end

  subgraph Harness["Harness 编排中枢"]
    HP["⭐ PseudoCodePlan"] --> HG["Generator"] --> HC["⭐ QAReasoner"]
    HC -->|"revision"| HG
    HC -->|"ok + QA-Checker pass"| HA["Authority Gate"]
  end

  subgraph Sandbox["Sandbox 沙盒"]
    ST["Tools<br/>ui · fs · http · report"]
    SF["fault isolation<br/>snapshot / restore"]
    CS["⭐ CodeActInterpreter<br/>Jupyter kernel per feature"]
    AT["⭐ code.search · symbol_nav<br/>doc · format · apply_patch"]
    ST --> SF
    CS --> SF
    AT --> SF
  end

  subgraph Orchestration["Orchestration 调度"]
    OD["scheduler + grants + approval"]
    SD["⭐ SelfDebugLoop<br/>rubber-duck retry"]
    HD["⭐ isLikelySandboxDenied<br/>→ code.escalate"]
    OV2["oversight + metrics + blind spots"]
    OM["memory + belief router<br/>⭐ CodeTraceMemory"]
    OD --> SD --> OV2 --> OM
    OV2 --> HD
  end

  Harness --> Sandbox
  Harness --> Orchestration
  Sandbox --> Harness
  Session -.-> Harness
  Session -.-> Orchestration
  Orchestration -.-> Session

  classDef break7 fill:#facc15,stroke:#a16207,color:#713f12,stroke-width:2px;
  class HP,HC,CS,AT,SD,HD,SG break7;
```

---

## 4. 多智能体握手时序（含 SelfDebugLoop）

```mermaid
sequenceDiagram
  autonumber
  actor Human as Principal
  participant P as Planner
  participant G as Generator
  participant Q as ⭐ QA-Checker
  participant C as Critic
  participant A as Authority
  participant K as ⭐ CodeAct Kernel
  participant S as SelfDebugLoop
  participant E as Evaluator
  participant L as Session Ledger
  participant T as ⭐ Sandbox Heuristic

  Human->>P: mission.created (+ manifest)
  P->>L: plan.recorded (PseudoCodeStep[]) + claim.recorded
  P->>G: candidate 请求
  G->>L: candidate.proposed
  G->>C: 请审查
  C->>C: 按 Constitution 原则批判
  alt 不符合
    C->>L: critique.recorded(失败) + revision.requested
    C-->>G: 请求修订
    G->>G: 重新生成候选
  else 符合
    C->>L: critique.recorded(通过)
    C->>Q: ⭐ QA-Checker 复核
    Q->>L: ⭐ verdict (on_topic + alignment)
    alt 评分不达标
    Q-->>C: ⭐ 要求修订
    C->>L: revision.requested
    else 通过
      C->>A: 请求执行
    end
  end
  A->>A: 能力授权 + 审批门
  A->>K: ⭐ effect.requested(code.repl)
  K->>K: ⭐ executeCell(refinement)<br/>stateful GLOBALS
  K->>L: ⭐ code.executed<br/>(stdout, stderr, returncode, blame?)

  alt 校验失败 → SelfDebugLoop 介入
    K->>S: ⭐ failure.attributed + block_blame
    loop attempt = 1..maxAttempts
      S->>L: ⭐ code.feedback(explanation, prevTrace)
      S->>K: ⭐ effect.requested(refined_code)
      K->>L: ⭐ code.executed
      S->>L: ⭐ code.retry(attempt, success)
    end
    alt 仍失败
      S->>L: rollback.requested + effect.reverted
    else 成功
      S->>L: ⭐ feature.updated(via: self-debug)
    end
  else 校验通过
    K->>L: effect.actualized
    K->>E: 请求校验
    E->>L: evidence.attached + evaluation.recorded
    E->>L: effect.verified + feature.updated(pass)
    E->>L: belief.asserted
  end

  rect rgb(250, 204, 21)
  Note over K,T: ⭐ Sandbox Heuristic 后台运行
  K->>T: 输出信号检查
  alt isLikelySandboxDenied + scope ∈ exec/write/fs
    T->>L: ⭐ code.escalate(suggested: danger-full-access)
    T->>A: 询问用户升级
  else keep-policy
    T-->>K: 继续按当前 scope
  end
  end
```

---

## 5. EventType 增量（黄底 = BREAK 7）

```mermaid
flowchart LR
  subgraph BASE["原 36 种 EventType"]
    direction TB
    B1["mission.created"]
    B2["claim.recorded"]
    B3["plan.recorded"]
    B4["candidate.proposed"]
    B5["critique.recorded"]
    B6["effect.intent"]
    B7["effect.requested"]
    B8["effect.actualized"]
    B9["evidence.attached"]
    B10["effect.verified"]
    B11["feature.updated"]
  end

  subgraph BREAK7["⭐ 新增 7 种 EventType（黄底）"]
    direction TB
    N1["code.executed<br/>REPL cell 完成"]
    N2["code.feedback<br/>rubber-duck 解释"]
    N3["code.retry<br/>attempt + success"]
    N4["code.symbol_resolved<br/>def 命中"]
    N5["code.apply_patch<br/>unified-diff 写入"]
    N6["code.plan_recorded<br/>PseudoCodeStep AST"]
    N7["code.escalate<br/>沙箱拒绝 → 询问升级"]
  end

  BASE --> BREAK7

  classDef break7 fill:#facc15,stroke:#a16207,color:#713f12,stroke-width:2px;
  class N1,N2,N3,N4,N5,N6,N7 break7;
```

---

## 6. 颜色图例（Color Legend）

| 颜色 | 含义 | CSS class |
| --- | --- | --- |
| 🟧 浅橙 | 状态/数据（State） | `state` fill:#fff7ed |
| 🟦 浅蓝 | 决策门（Gate） | `gate` fill:#eff6ff |
| 🟩 浅绿 | 写入/成功（Write） | `write` fill:#f0fdf4 |
| 🟥 浅红 | 失败/回滚（Fail） | `fail` fill:#fef2f2 |
| 🟨 **黄底** | **BREAK 7 新增**（CodeAgent） | **`break7` fill:#facc15** |
| 🟨 浅黄（kernel 子色） | Python 子进程状态 | `kernel` fill:#fef9c3 |
| 🟧 深黄（warn） | 收尾/警告 | `warn` fill:#fffbeb |

**黄底节点 = BREAK 7 创新**：
- `Planner` 输出 `PseudoCodeStep[]` AST（替代 NLP steps）
- `QA-Checker` 新 lane（EMNLP'24 CodeAgent）
- `effect.actualized` 走 Jupyter stateful kernel
- `evidence.attached` 携带 `block_blame`（LDB）
- `SelfDebugLoop` 替换 immediate rollback（ICLR'24）
- `feature.updated.via` = `'self-debug'` 标识
- `EpisodicMemory` 增加 `CodeTraceMemory` schema
- `Oversight` 跑 `isLikelySandboxDenied` → `code.escalate`
