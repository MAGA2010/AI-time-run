# MDIBUS V18 到 AI Time Run 的映射与创新

AI Time Run 以 `MDIBUS-Runtime Architecture V18` 为蓝本，保留其
`State-Evidence-Authority-Coordination` 核心范式，同时在三处做了明确创新。
下面是九大模块的一一对应关系。

## 九大模块映射

| MDIBUS 模块 | AI Time Run 实现 | 状态 |
| --- | --- | --- |
| 01 Principal + Mission | `Mission`（protectedIntentions、capabilityBoundary）、`AuthorityEngine` 授权日志 | 已实现 |
| 02 Cognitive Services | `Simulator`（反事实模拟）、`Planner`、`ObserverBridge`、`Sandbox` | 已实现 + 创新 |
| 03 MDIBUS Kernel | `Ledger + project`（事件溯源）、`CausalGraph`、`Claim/Evidence/Belief`、`ConjectureScheduler`、`AuthorityEngine` | 已实现 + 创新 |
| 04 Actor Kernel | `Planner/Generator/Critic/Evaluator` 四角色、`IdentityEngine` 身份绑定、宪法修订环 | 部分实现 |
| 05 Capability + Session Fabric | `TrustGateway`、`Sandbox`、`AuthorityEngine`、故障隔离 | 已实现 + 创新 |
| 06 Environments / World | `Sandbox` 工具（ui/fs/http/report）、`FileSystemAdapter` 真实文件系统 | 部分实现 |
| 07 Effect + Verification Loop | `checkpoint -> actualized -> probe -> verified/reverted` | 已实现 |
| 08 Workspace + Durable Memory | `ProgressJournal`、`ArtifactStore`、`EpisodicMemory`、`FailureMemory`、`BeliefRouter`、`SelectiveWorkspace` | 已实现 |
| 09 Eval + Human Oversight | `Oversight`（metrics + blindSpots + escalate）、审批门、停机 | 已实现 |

## 三处创新

### 1. 反事实模拟认知层（OMEGA）

典型运行时直接执行工具并承受副作用。AI Time Run 的 `Simulator` 会先在沙盒里跑
一遍，快照、执行、再回滚，把“如果这样做会怎样”写成 `simulation.recorded` 事件。
规划者因此能在不动真实世界的情况下探索 Δ-state，副作用被彻底隔离。

### 2. 因果历史与隔离图

`CausalGraph` 从每条事件的 `parent` 链接重建显式 DAG，可求祖先、后代、深度并证明
无环。`classifyEffect` 把高影响副作用标为 `atomic`（不可中断），其余标为
`parallel`（可并行）。这让“哪些操作必须原子、哪些可以并行、谁依赖谁”成为可审计的
事实，而不是散落在代码里。

### 3. 语义信任网关

`TrustGateway` 强制执行“不可信内容不能改变信任”。只有来自可信来源（探测/观察）且
`ok` 的证据才能翻转功能、信念或权限；工具输出（`trace`）即使成功也不能直接改信任。
这补上了从“效应发生”到“被信任”之间缺失的一道门。

## 尚未覆盖的 MDIBUS 能力

以下能力在蓝图中存在，但当前版本没有实现，留作后续：

- 04 `Identity Engine`：模型/容器/信任域身份绑定与选择性握手。
- 04 `Goal Conflict Resolver`：多目标冲突检测与权限下调。
- 04 `External-Agent-Adapter`：有边界的跨 Agent 委托契约。
- 06 浏览器/Shell/API 的真实环境适配器与确定性建模。
- 09 `Belief-Eval-Lab`：假设模拟与现实对比分析。

这些模块的接口边界已经由 `Reasoner`、`Tool`、`TrustGateway` 和 `CausalGraph`
预留，可以在不重写运行时的情况下逐步接入。
