# MDIBUS V18 完整蓝图

下面按 MDIBUS-Runtime Architecture V18 的九大模块，把每个子组件都画出来。
`09 人机监督` 以虚线反向介入全链路，`08 持久记忆` 把结果回灌 `02 认知服务`。
每个模块不再是一个团簇，而是一条逻辑链：一个节点只承载一个概念，边就是工作流顺序。

```mermaid
flowchart TB
  subgraph M1["01 Principal + Mission"]
    direction LR
    m1a["Principal<br/>人"] --> m1b["intent-contract<br/>意图契约"] --> m1c["capability-boundary<br/>能力边界"] --> m1d["protected-intentions<br/>受保护意图"] --> m1e["compulsion-log<br/>强制日志"]
  end

  subgraph M2["02 Cognitive Services"]
    direction LR
    m2a["planning-service<br/>规划服务"] --> m2b["OMEGA-simulation<br/>反事实模拟"] --> m2c["observer-monitor<br/>观测监控"] --> m2d["control-compiler<br/>控制编译"] --> m2e["sandboxed<br/>沙盒化执行"]
  end

  subgraph M3["03 MDIBUS Kernel"]
    direction LR
    m3a["evidence/claim-logger<br/>证据/主张日志"] --> m3b["causal-history<br/>因果历史"] --> m3c["dependency/insulation-graph<br/>依赖/隔离图"] --> m3d["isolation<br/>隔离"] --> m3e["retainer<br/>保留器"] --> m3f["conjecture-scheduler<br/>猜想调度"] --> m3g["belief-consumer<br/>信念消费"] --> m3h["policy-engine<br/>策略引擎"]
  end

  subgraph M4["04 Actor Kernel"]
    direction LR
    m4a["identity-engine<br/>身份引擎"] --> m4b["lanes<br/>车道"] --> m4c["trigger/dispatch<br/>触发/分发"] --> m4d["goal-conflict-resolver<br/>目标冲突解决"] --> m4e["COW-model-state<br/>写时复制状态"]
  end

  subgraph M5["05 Capability + Session"]
    direction LR
    m5a["semantic-trust-gateway<br/>语义信任网关"] --> m5b["evidence-arbiter<br/>证据仲裁"] --> m5c["abstraction-detector<br/>抽象检测"] --> m5d["precedent-session<br/>先例会话"] --> m5e["crash-isolation<br/>崩溃隔离"]
  end

  subgraph M6["06 Environments / World"]
    direction LR
    m6a["world<br/>世界状态"] --> m6b["filesystem"]
    m6a --> m6c["shell/PTY"]
    m6a --> m6d["browser"]
    m6a --> m6e["API/cloud/CRUD"]
    m6a --> m6f["robotics"]
    m6g["determinism<br/>确定性建模"] -.-> m6a
  end

  subgraph M7["07 Effect + Verification"]
    direction LR
    m7a["checkpoint-recovery<br/>检查点恢复"] --> m7b["actualized-action<br/>实际动作"] --> m7c["verification-probe<br/>验证探测"] --> m7d["effect-validator<br/>效应校验"]
  end

  subgraph M8["08 Workspace + Durable Memory"]
    direction LR
    m8a["journal<br/>日志"] --> m8b["artifact-store<br/>工件存储"] --> m8c["failure/episodic-memory<br/>失败/情景记忆"] --> m8d["belief-router<br/>信念路由"] --> m8e["selective-workspace<br/>选择性工作区"]
  end

  subgraph M9["09 Eval + Human Oversight"]
    direction LR
    m9a["reliability-metrics<br/>可靠性指标"] --> m9b["blind-spot<br/>盲区检测"] --> m9c["belief-eval-lab<br/>信念评估"] --> m9d["refusing-eval<br/>拒绝评估"] --> m9e["safeguard<br/>安全护栏"] --> m9f["mission-download<br/>任务下载"]
  end

  m1e --> m2a
  m2e --> m3a
  m3h --> m4a
  m4e --> m5a
  m5e --> m6a
  m6a --> m7a
  m7d --> m8a
  m8e -.->|"evidence / memory feedback"| m2b

  m9f -.->|"oversight"| m1a
  m9f -.->|"oversight"| m3a
  m9f -.->|"oversight"| m4a
  m9f -.->|"oversight"| m5a
  m9f -.->|"oversight"| m7a
  m9f -.->|"oversight"| m8a
```

## 与实现的对应

| 模块 | 已实现组件 | 预留 / 未来 |
| --- | --- | --- |
| 01 | `Mission`、`AuthorityEngine` 授权日志 | 人机意图契约的显式 UI |
| 02 | `Simulator`(OMEGA)、`Planner`、`ObserverBridge`、`Sandbox` | Control Compiler |
| 03 | `Ledger`、`CausalGraph`、`Claim/Evidence/Belief`、`ConjectureScheduler`、`AuthorityEngine` | Retainer 策略引擎 |
| 04 | `Planner/Generator/Critic/Evaluator`、`IdentityEngine` | Goal Conflict Resolver、External-Agent-Adapter、COW Model State |
| 05 | `TrustGateway`、`Sandbox`、故障隔离 | Precedent-Session、Abstraction Detector、Evidence Arbiter |
| 06 | `Sandbox` 工具、`FileSystemAdapter`（真实文件系统） | Browser/Shell/API/Determinism 适配器 |
| 07 | `checkpoint -> probe -> verified/reverted` | Effect-Validator 差异断言 |
| 08 | `ProgressJournal`、`ArtifactStore`、`EpisodicMemory`、`FailureMemory`、`BeliefRouter`、`SelectiveWorkspace` | — |
| 09 | `Oversight`、审批门、停机、`escalate()` 自动升级 | Belief-Eval-Lab、Refusing-Evaluation、Mission-Download |
