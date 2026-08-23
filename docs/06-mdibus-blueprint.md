# MDIBUS V18 完整蓝图

下面按 MDIBUS-Runtime Architecture V18 的九大模块，把每个子组件都画出来。
`09 人机监督` 以虚线反向介入全链路，`08 持久记忆` 把结果回灌 `02 认知服务`。

```mermaid
flowchart TB
  M1["01 Principal + Mission<br/>intent-contract · capability-boundary<br/>protected-intentions · compulsion-log"]
  M2["02 Cognitive Services<br/>OMEGA-simulation · planning-service<br/>observer-monitor · sandboxed · control-compiler"]
  M3["03 MDIBUS Kernel<br/>retainer · dependency/insulation-graph<br/>isolation · causal-history · evidence/claim-logger<br/>conjecture-scheduler · belief-consumer · policy-engine"]
  M4["04 Actor Kernel<br/>lanes · identity-engine · trigger/dispatch<br/>goal-conflict-resolver · COW-model-state"]
  M5["05 Capability + Session<br/>semantic-trust-gateway · precedent-session<br/>abstraction-detector · evidence-arbiter · crash-isolation"]
  M6["06 Environments / World<br/>determinism · robotics · API/cloud/CRUD<br/>browser · shell/PTY · filesystem"]
  M7["07 Effect + Verification<br/>checkpoint-recovery · actualized-action<br/>verification-probe · effect-validator"]
  M8["08 Workspace + Durable Memory<br/>journal · artifact-store · failure/episodic-memory<br/>belief-router · selective-workspace"]
  M9["09 Eval + Human Oversight<br/>reliability-metrics · blind-spot<br/>belief-eval-lab · refusing-eval · safeguard · mission-download"]

  M1 --> M2 --> M3 --> M4 --> M5 --> M6 --> M7 --> M8
  M8 -.->|"evidence / memory feedback"| M2
  M9 -.->|"oversight"| M1
  M9 -.->|"oversight"| M3
  M9 -.->|"oversight"| M4
  M9 -.->|"oversight"| M5
  M9 -.->|"oversight"| M7
  M9 -.->|"oversight"| M8
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
