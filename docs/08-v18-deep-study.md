# MDIBUS V18 完全学习笔记

本文把 `MDIBUS-Runtime Architecture V18` 从头到尾逐行拆开：每个概念先讲清它
**到底在说什么**，再标出它在我们仓库里**已经落到哪 / 还缺什么 / 值不值得学**。
不省略、不美化，原文里无法确认的词会明确标出“存疑”。

## 0. 一句话定位

V18 是「长周期自主智能体运行时」的九模块蓝图，核心范式是
**State‑Evidence‑Authority‑Coordination（状态‑证据‑权限‑协同）**。它要解决的不是
“模型不够聪明”，而是模型在长任务里会忘状态、会说谎、会越权、会留下烂摊子、会失败后
乱改，所以需要一层运行时把这些都管起来。

数据流主线：`01 任务 → 02 认知 → 03 事件内核 → 04 多智能体 → 05 能力会话 →
06 环境执行 → 07 校验闭环 → 08 持久记忆`；`09 人机监督`反向介入全链路。

## 1. 01 PRINCIPAL + MISSION 主体与任务

| 原文 | 含义 | 我们现状 | 值得学 |
| --- | --- | --- | --- |
| human-filter-norm-constraints | 人类过滤/规范/约束是第一优先级输入 | `Mission.protectedIntentions` 部分对应 | 把“人类约束”建模成不可覆盖的一等数据 |
| authority-boundaries / mandate-scope | 授权边界与委托范围 | `Mission.capabilityBoundary` 已有 | 边界要可枚举、可检查 |
| no-override / no-rewrite back | 受保护意图不能被覆盖/回写 | `protectedIntentions` 已有，但无人校验 | 需要一个“意图不可改”的校验器 |
| delegated-beliefs | 被委托的信念 | `BeliefRouter` 有，但无委托来源 | 信念要带“谁委托的”来源 |
| Compulsion Log | 强制/委托/约束的不可否认日志 | 缺；只有 `grant.issued/revoked` | 把“谁被强制做了什么”单独成日志 |
| intent-contract-judgement | 人做意图契约裁决 | 缺；只有 `approve` 回调 | 契约冲突时由人裁决，而非硬报错 |

小结：01 的核心是“**意图与边界是数据，且高于一切**”。我们只实现了 Mission 和授权日志，
“意图不可改”和“强制日志”还没做实。

## 2. 02 COGNITIVE SERVICES 认知服务

| 原文 | 含义 | 我们现状 | 值得学 |
| --- | --- | --- | --- |
| OMEGA / Simulation | 用“替代世界模型”做反事实推演 | `Simulator` 已有，但未接主循环 | 先模拟、后执行，模拟结果作为动手前的证据 |
| Planning Service | 规划服务 | `Planner` + `plan()` 已有 | — |
| Situation-Awareness / Δ-Q Δ-state | 态势感知 + 状态/价值增量探索 | 缺 | 规划时评估“状态变多少、代价多大” |
| Observer-Monitor / Observation Bridge | 观测桥：情境 → 证据流 | `ObserverBridge` + `runProbe` 已有 | 观测要能变成证据流，而不是一次性快照 |
| Sandboxed | 沙盒化，评估能力/可靠性/成本/方差 | `Sandbox` 已有（故障隔离） | 增加“成本/方差”维度，不只 ok/error |
| Control Compiler | 语义规约 → 规范代理脚本 → 规范方言 | 缺 | 把高层意图编译成可执行、可审计的动作 |

小结：02 是“**在脑子里先想清楚，再动手**”。我们已有模拟器和观测桥，但没把“想”变成
动手前的强制门。

## 3. 03 MDIBUS KERNEL 事件溯源持久语义

这是 V18 的地基，也是我们做得最全的一块。

| 原文 | 含义 | 我们现状 | 值得学 |
| --- | --- | --- | --- |
| Retainer | 外部必须输入时外部赢；能确定时就强制确定 | 缺 | 运行时约束优先级，减少随机性 |
| Dependency / Insulation Graph | 依赖/隔离图 | `CausalGraph` + `classifyEffect` 已有 | 把 atomic/parallel 真正用于调度，而不是展示 |
| Isolation | 权限隔离约束执行器 | `AuthorityEngine` 部分 | 隔离要按 scope 强制，而非建议 |
| Causal-History-Kernel | 因果历史：每个状态凭什么被构造 | `Ledger.parent` + `CausalGraph` 已有 | 加上“构造证据 + 资源 + 声誉” |
| Evidence Logger | 证据日志：出处/事实核查/追踪归档 | `evidence.attached` 已有 | 证据要带 provenance（来源链） |
| Claim Logger | 主张日志：作者输出≠真相 | `claim.recorded` 已有 | 核心原则，已经落地 |
| Conjecture Scheduler | 信息缺口 → 假设构建 | `ConjectureScheduler` 已有 | 接上“假设→模拟→证伪”闭环 |
| Belief Consumer | 用反事实场景“捏”信念 | `BeliefRouter` 部分 | 信念要能被证伪、被墓碑 |
| Authority-Policy-Engine | 委托规则即强制数据 | `AuthorityEngine` 已有 | 规则数据化，已基本对应 |

小结：03 的**思想**我们已经抓住了（事件溯源 + Claim/Evidence），但“密码学完整性”
和“图调度”还没落地。

## 4. 04 ACTOR KERNEL 多智能体协同

| 原文 | 含义 | 我们现状 | 值得学 |
| --- | --- | --- | --- |
| Lanes / Ownership | 车道与所有权：机制只回自己那条 | `ROLES` 有，但无“只回”约束 | 角色与车道绑定，越界即违规 |
| Identity Engine | 模型/容器/信任域/身份绑定 + 选择性握手 | 缺；actor 只是字符串 | **最高价值**：身份签名 + 握手 |
| Trigger / Dispatch | 事件生产/消费分发 | `orchestrator` 隐式 | 显式事件总线 |
| Goal Conflict Resolver | 目标冲突检测 + 冲突时降权 | 缺 | 柔性冲突：容忍冲突、下调权限 |
| Coordinated-State-Population | 规范操作 + 失败任务重试 | 部分 | 失败重试要带归因，不能盲重试 |
| Identity Monitor | 篡改校验本地状态 + 委托代理适配 | 缺 | 身份变更要可检测 |
| External-Agent-Adapter | 有边界的跨 Agent 委托契约 | 缺（路线图已列） | 委托要有契约与权限边界 |
| Model State (Quantum Copy-On-Write) | 状态按 delta 写时复制，只 fork 局部 | 缺；只有 snapshot/restore | 高效、隔离的状态分叉 |
| ANKET-EVICTION-SLOT-ALLOC-BLOCKER | 存疑（疑似内部缩写/拼写问题） | — | 原文无法确认，不硬套 |

小结：04 是 V18 里**最“未来”**的一块，核心是“身份 + 冲突柔化 + 写时复制”。我们只有
四个角色，身份和冲突解决完全没做。

## 5. 05 CAPABILITY + SESSION FABRIC 能力与会话编织层

| 原文 | 含义 | 我们现状 | 值得学 |
| --- | --- | --- | --- |
| Semantic-Trust Gateway | 语义信任网关：不可信内容不能改信任 | `TrustGateway` 已有，但只查 kind+ok | 升级成带身份/签名的真语义信任 |
| Precedent-Session Manager | 会话内资源授予，撤销会话即总权限失效 | 部分 | 会话撤销要连带所有权限失效 |
| Abstraction Detector | 语义接口边界等级控制 | 缺 | 接口抽象层级控制 |
| Evidence Arbiter | 真相/质量报告者，有权威 | 部分 | 证据要有“谁有权报告” |
| permission-provision-effects-observations | 权限/供应/效应/观测一一对应 | 部分 | 效应声明必须落回观测 |
| Embedded-Capability-Crash | 故障隔离、会话杀掉 | `Sandbox` 已有 | 会话级隔离，而非仅工具级 |

小结：05 的核心是“**信任和权限都在会话生命周期里被约束**”。我们只有信任网关和工具级
故障隔离，会话级和语义级还缺。

## 6. 06 ENVIRONMENTS / WORLD 环境与外部世界

| 原文 | 含义 | 我们现状 | 值得学 |
| --- | --- | --- | --- |
| Determinism | 可做任务用 ground-truth 预测模型 | 缺 | 确定性环境优先，减少随机 |
| Physical / Robotics | 高延迟真实世界效应边界 | 缺 | 高延迟/不可逆效应要特殊门 |
| API / Web / Cloud / CRUD | 能确定就确定 | 缺 | 真实网络适配器 |
| Browser | DOM/AX/读屏/持久目标 | 缺 | 浏览器适配器 |
| Shell / Process / PTY | 抽象进程/终端 | 缺 | Shell 适配器 |
| Filesystem | 真实写、watch | 缺（demo 是假 world） | **最该先做**：一条真文件链路 |
| Boundary | diff-history-comming（存疑拼写） | — | 边界差异历史 |
| Dvs / Adevait-semantic-wrappers | 存疑（疑似内部词/拼写） | — | 原文无法确认 |

小结：06 我们目前**全是假环境**，这是“演示可信度”的最大软肋。至少文件系统要做成真的。

## 7. 07 EFFECT + VERIFICATION LOOP 执行‑校验闭环

| 原文 | 含义 | 我们现状 | 值得学 |
| --- | --- | --- | --- |
| Checkpoint-Recovery | 提交/请求/回滚 | `checkpoint.created` + `rollback.requested` 已有 | 已落地 |
| verified-effect-requested-output | 直到报告，永远不够 | `effect.verified` 已有 | 只有外部报告才算完成 |
| Actualized-Action | 被请求、被验证过的实际动作 | `effect.actualized` 已有 | 已落地 |
| Verification-Probe | 观测者做确定性检查 | `runProbe` 已有 | 已落地 |
| Effect-Validator | 差异断言性能 | 部分 | 断言“期望 vs 实际”差异 |

小结：07 是我们**完成度最高**的模块，闭环已经跑通。

## 8. 08 WORKSPACE + DURABLE MEMORY 工作区与持久记忆

| 原文 | 含义 | 我们现状 | 值得学 |
| --- | --- | --- | --- |
| Programmed Journal | 进度日志 + 检查点 | `ProgressJournal` 已有 | 已落地 |
| Artifact Store | 代码/报告/需求追踪 | `ArtifactStore` 已有 | 已落地 |
| Failure-Memory-log | 失败操作历史 | `FailureMemory` 已有（内存） | 失败要持久化 + 归因 |
| Episodic-Memory | 任务片段复盘 | `EpisodicMemory` 已有（内存） | 复盘要能喂回认知层 |
| Failure-/Campaign-Memory | 失败/战役记忆 | 部分 | 跨会话失败模式学习 |
| Belief-Router | 发布/订阅事实链接 + 墓碑 | `BeliefRouter` 已有 | 已落地 |
| Selective-Workspace | 只放硬约束/黑名单/关键证据 | 缺；只有 `summarize` | **解决 context-anxiety 的关键** |

小结：08 的**存储**我们有了，但记忆目前大多只在内存，不跨会话；`Selective-Workspace`
是解决上下文焦虑的关键，还没做。

## 9. 09 EVAL + HUMAN OVERSIGHT 评估与人机监督

| 原文 | 含义 | 我们现状 | 值得学 |
| --- | --- | --- | --- |
| Reliability / Failure Metrics | 成功率/暂停/风险/成本/人工阈值 | `Oversight.metrics` 部分 | 指标要接阈值与自动动作 |
| Advanced Control Edits | 智能重配置/选择性动作验证 | 缺 | 监督不只报告，要能改配置 |
| Monitor-Blind-Spot | 状态/日志/堆/健康/校准/策略分析 | `Oversight.blindSpots` 部分 | 盲区要触发升级（回滚/降权） |
| Belief-Eval-Lab | 假设模拟 vs 现实对照 | 缺 | 假设与现实的差异分析 |
| Refusing-Evaluation | 机制分类失败 + 端到端评估置信度 | 缺 | 模型要能“拒绝”，并评估置信度 |
| Safeguard-4-Access | 中断响应、调制、入侵触发 | 缺 | 入侵/异常时的紧急中断 |
| Mission-Download | 暂停、保存资源、评估世界变化与风险 | 缺 | 优雅停机，不是粗暴 kill |

小结：09 是“**兜底**”层。我们只有 metrics 和 blindSpots 的“报告”，没有“动作”。

## 10. 完全学习后的结论

按完成度从高到低：

- **已跑通**：07 执行校验闭环、03 事件溯源内核（Claim/Evidence）、08 的存储类。
- **半成品**：01 意图边界、02 模拟器、05 信任网关、09 指标盲区。
- **基本空白**：04 身份/冲突/COW、06 真实环境、08 选择性工作区、09 自动监督动作。

按“创新性价比”从高到低，最值得下一步投入的四个点：

1. **身份 + 签名**（04 Identity Engine + 05 语义信任）：把“谁说谎”变成密码学可判。
2. **先模拟后执行**（02 OMEGA）：把 Simulator 变成动手前的门。
3. **失败→干预闭环**（03/08 + Life-Harness）：让 harness 从失败里自己长约束。
4. **真实文件系统链路**（06）：让 demo 至少有一条不是假 world 的真路径。

这份笔记是“学”，下一份是“做”。想从哪一条开始做，我再把它落成代码。
