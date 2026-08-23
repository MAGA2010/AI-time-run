# 三篇 Harness 论文深度拆解与复制清单

这三篇 2026 年 arXiv 论文把此前 Anthropic 工程博客里“看起来像 harness”的东西，
提升成了一个有定义、有阶梯、有证据协议、有安全分层的学科。本文不重复摘要，只记录
能直接落到本仓库的机制，并给出一张“复制什么 / 落在哪里 / 已经有哪些 / 还缺哪些”的
映射表。

## 1. AI Harness Engineering（arXiv:2605.13357）

### 1.1 它真正改变了什么

论文把“自主软件工程能力”从模型身上拿掉，重新定义为三者的涌现属性：

```text
C_system = F(C_model, C_harness, C_environment, T)
```

其中 `C_model` 是模型潜在能力，`C_environment` 是环境暴露出的东西，
`C_harness` 是夹在中间的运行时基底，`T` 是任务分布。Harness 决定的是：
潜在模型能力能不能变成“可审计的软件工程行为”。这直接反对“模型不行就继续训练更大模型”
的默认归因。

它由此定义了一个可度量的缺口：

```text
autonomy gap = 模型局部编码能力 - 系统在无人补位时完成任务的完整能力
```

以及把“人类帮忙”从噪声改造成诊断信号的指标：

```text
M-HIR = missing-harness interventions / total episodes
```

一次人类干预如果是因为“缺少上下文管理 / 缺少可观测性 / 缺少验证协议 / 缺少熵审计”，
它就是 `missing-harness intervention`；Harness 的价值就是把 M-HIR 压下去。

### 1.2 八类失败（不是 pass/fail，而是归因）

论文要求把失败归因到“缺哪种运行时支持”，而不是一句“模型失败了”：

| 符号 | 失败类型 | 含义 |
| --- | --- | --- |
| `F_context` | 上下文失败 | 看错文件、漏掉约束 |
| `F_tool` | 工具失败 | 工具缺失、不稳定、被误用 |
| `F_feedback` | 反馈失败 | 反馈不可得或不可解释 |
| `F_verify` | 验证失败 | 无法证明需求满足 |
| `F_recovery` | 恢复失败 | 无法从失败中恢复 |
| `F_entropy` | 熵失败 | 引入维护负担（残留、文档漂移、依赖抖动） |
| `F_model` | 模型失败 | 环境与 harness 充分，纯推理/编码错误 |
| `F_unknown` | 未知 | 无法自信归因 |

### 1.3 十一条职责（我们补缺的锚点）

论文给出一张职责表，每一行都对应一个“缺了它就会出现哪种失败、会留下哪类证据”：

| 职责 | 运行时契约 | 缺失时的失败 | 应产出的证据 |
| --- | --- | --- | --- |
| Task interface | 呈现目标/需求/约束/成功标准 | 目标不明、做错方向 | Task record |
| Context manager | 选择并暴露相关项目内容 | 看错文件、漏约束 | Context trace |
| Tool registry | 声明可用工具与命令 | 调用失败、危险命令、反复超时 | Tool trace |
| Project memory | 提供架构/测试/已知失败知识 | 重复发现、修错层 | Memory references |
| Task state | 维护假设、已看文件、开放问题、下一步 | 漂移、重复劳动 | Task-state file |
| Observability | 暴露日志/追踪/输出/运行时错误 | 成功不可证、失败不可诊断 | Observation log |
| Failure attribution | 分离观测、期望行为、诊断 | 失败后随机乱改 | Attribution log |
| Verification protocol | 把需求映射到确定性证据 | 未经验证的成功、虚假自信 | Verification trace |
| Permission boundary | 限制危险动作、暴露审批门 | 不安全、无效 episode | Permission record |
| Entropy auditor | 检测 agent 引入的维护负担 | 文档漂移、依赖抖动、残留 | Entropy audit |
| Intervention logger | 记录人类辅助及其可否避免 | 人类脚手架不可见 | Intervention log |

八类执行证据（action / tool / context / verification / failure attribution /
intervention / entropy / outcome）里，我们此前已经覆盖了前四类加 outcome，
**缺的是 failure attribution、intervention、entropy 三类**。这就是本仓库本轮补的三个事件：
`failure.attributed`、`intervention.recorded`、`entropy.audited`。

### 1.4 五条设计原则

- P1 Explicit runtime resources：上下文、工具、项目记忆、验证证据、人类注意力、
  权限边界、维护状态都必须显式命名，而不是隐式存在。
- P2 Traceable mediation：记录 agent 如何选上下文、调工具、验证、恢复、触发干预。
- P3 Requirement-level verification：完成绑定确定性证据，而不是自然语言自述。
- P4 Attribution before recovery：失败观测后先归因分类，再动手改。
- P5 Maintenance and entropy awareness：维护负担是闭环的一部分，不是圈外噪音。

### 1.5 H0-H3 能力阶梯

阶梯通过“逐步向 agent 暴露运行时支持”来把 harness 的贡献与模型的贡献分开测量：

- H0：只产出最终 patch，没有中间证据。
- H1：暴露上下文与工具，留下行动/工具轨迹，但没有验证协议。
- H2：加入证据与验证，`effect.verified`、确定性检查出现。
- H3：完整 episode 包，含复现日志、失败归因、确定性需求检查、结构化验证报告。

本仓库的 `buildEpisode()` 会把一条 ledger 归类到 H0-H3：等级由“账本里是否真的存在
归因、确定性检查、验证报告、熵审计”决定，而不是由 README 声称决定。

### 1.6 我们从这篇复制什么

1. **Episode package**：把一次运行打包成 `ReproductionLog + FailureAttribution +
   DeterministicChecks + VerificationReport + EntropyAudit + Interventions`，
   作为可审计、可离线重放的工件（`src/episode.ts`）。
2. **补齐十一项职责**：新增熵审计与干预记录，把项目显式定位到 H2/H3。
3. **M-HIR 指标**：把“人类审批/干预”分成 `avoidable` 与 `unavoidable`，
   让干预日志能够回答“这次人工介入能不能用 harness 消除”。
4. **失败八分类**：把 `rollback` 与失败路径写入 `failure.attributed`，带上
   `context/tool/feedback/verify/recovery/entropy/model/unknown` 类型。

## 2. Life-Harness（arXiv:2605.22166）

### 2.1 核心论点

“不碰模型权重，也不碰评测环境，只改运行时接口”就能让冻结 LLM agent 变强。
在确定性、规则约束领域，很多失败来自 model-environment 接口不匹配，而不是模型笨。

Life-Harness 从训练轨迹里学习：把反复出现的交互失败，转成四类可复用干预：

- environment contracts：环境契约（约束、字段、前置条件）
- procedural skills：过程技能
- action realization：动作实现
- trajectory regulation：轨迹调节

训练出的 harness 在评测时保持冻结，用于未见任务。

### 2.2 数字

- 7 个确定性环境（`tau-bench`、`tau^2-bench`、AgentBench）
- 18 个模型 backbone、126 个 model-environment 组合里，改进了 116 个
- 平均相对提升 **88.5%**
- 只用 `Qwen3-4B-Instruct` 轨迹演化出的 harness，能迁移到另外 17 个模型

最后一条最关键：它说明 harness 捕捉到的是“环境侧结构”，而不是某个模型的特性。
这正好是 Life-Harness 与模型微调的根本区别。

### 2.3 我们从这篇复制什么

把“失败 → 干预”变成闭环，而不是只把失败记下来：

1. `FailureMemory` 中的反复失败，可以自动生成宪法原则或工具前置条件
   （对应 environment contracts / trajectory regulation）。
2. `intervention.recorded` 成为一等事件，记录 `kind / subject / avoidable`，
   让“这次干预是否可被 harness 消化”可统计。
3. 把 `constitution.ts` 从静态原则升级为“可从失败轨迹追加原则”的演化接口
   （本轮先落事件与数据结构，原则自动生成作为路线图）。

## 3. SafeHarness（arXiv:2604.13630）

### 3.1 四层防御与跨层升级

SafeHarness 把安全直接织进 agent 生命周期四个阶段：

| 生命周期阶段 | 防御层 | 本仓库落点 |
| --- | --- | --- |
| 输入处理 | adversarial context filtering | `Sandbox` 输入边界 + `Mission` 能力边界 |
| 决策 | tiered causal verification | `CausalGraph` + `effect.verified` 证据链 |
| 动作执行 | privilege-separated tool control | `AuthorityEngine`（read/act/oversee 分级） |
| 状态更新 | safe rollback + adaptive degradation | `checkpoint.created` + `rollback.requested` |

关键在于 **cross-layer escalation**：当检测到“持续异常”时，不只是本层反应，
而是联动升级——提高验证严格度、触发回滚、收紧工具权限。这是四层能组成系统的原因。

### 3.2 数字

对比未防护基线，SafeHarness 平均降低：

- UBR（unsafe behavior rate）约 **38%**
- ASR（attack success rate）约 **42%**

同时保持核心任务效用（不是靠“拒绝一切”换安全）。

### 3.3 我们从这篇复制什么

1. **cross-layer escalation**：把 `Oversight.blindSpots()` 从“只报告”升级为
   “持续盲区 → 自动触发回滚 / 收紧权限 / 提高验证严格度”的升级动作。
2. **privilege-separated tools**：现有 `grant` 已经分级，补上“异常时降级”的路径
   （`revokeGrant` 作为升级动作）。
3. **tiered causal verification**：现有因果图 + 证据链已经具备雏形，补齐“按严重度
   分层验证”的阈值语义。

## 4. 优先级复制表

| 优先级 | 复制内容 | 来源 | 目标模块 | 状态 |
| --- | --- | --- | --- | --- |
| P0 | Episode 审计包（复现日志/归因/确定性检查/验证报告） | 2605.13357 | `src/episode.ts` | 本轮实现 |
| P0 | 补齐 11 项职责：熵审计 + 干预记录 + 失败归因 | 2605.13357 | `src/episode.ts` / `orchestrator.ts` | 本轮实现 |
| P0 | H0-H3 阶梯定位 | 2605.13357 | `buildEpisode()` | 本轮实现 |
| P1 | M-HIR 干预可避免性统计 | 2605.13357 | `Oversight.metrics()` | 本轮实现 |
| P1 | 失败八分类落到事件 | 2605.13357 | `failure.attributed` | 本轮实现 |
| P1 | 失败 → 干预闭环（原则/前置条件自动生成） | 2605.22166 | `constitution.ts` / `memory.ts` | 路线图 |
| P1 | cross-layer escalation（盲区 → 回滚/降权） | 2604.13630 | `oversight.ts` / `authority.ts` | 路线图 |
| P2 | adversarial context filtering 量化 | 2604.13630 | `sandbox.ts` | 路线图 |

## 5. 一句话结论

这三篇合起来给了一个清晰的分工：13357 告诉我们 **harness 该留下什么证据**，
22166 告诉我们 **harness 本身能从失败里学习**，13630 告诉我们 **harness 必须把
安全分层并允许跨层升级**。本仓库的锚点是第一条：先让一条 ledger 能产出完整、
可离线验证、可归因的 Episode 包，再把学习与升级做成路线图。
