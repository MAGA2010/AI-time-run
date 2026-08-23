# MDIBUS V18 完整蓝图

下面按 MDIBUS-Runtime Architecture V18 的九大模块，把每个子组件都画出来。
`09 人机监督` 以虚线反向介入全链路，`08 持久记忆` 把结果回灌 `02 认知服务`。

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

## 与实现的对应

| 模块 | 已实现组件 | 预留 / 未来 |
| --- | --- | --- |
| 01 | `Mission`、`AuthorityEngine` 授权日志 | 人机意图契约的显式 UI |
| 02 | `Simulator`(OMEGA)、`Planner`、`ObserverBridge`、`Sandbox` | Control Compiler |
| 03 | `Ledger`、`CausalGraph`、`Claim/Evidence/Belief`、`ConjectureScheduler`、`AuthorityEngine` | Retainer 策略引擎 |
| 04 | `Planner/Generator/Critic/Evaluator` | Identity Engine、Goal Conflict Resolver、External-Agent-Adapter、COW Model State |
| 05 | `TrustGateway`、`Sandbox`、故障隔离 | Precedent-Session、Abstraction Detector、Evidence Arbiter |
| 06 | `Sandbox` 工具 | Browser/Shell/API/Determinism 适配器 |
| 07 | `checkpoint -> probe -> verified/reverted` | Effect-Validator 差异断言 |
| 08 | `ProgressJournal`、`ArtifactStore`、`EpisodicMemory`、`FailureMemory`、`BeliefRouter` | Selective-Workspace 上下文窗口控制 |
| 09 | `Oversight`、审批门、停机 | Belief-Eval-Lab、Refusing-Evaluation、Mission-Download |
