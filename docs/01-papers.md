# 论文与技术博客合集

本文是 AI Time Run 的工程源头合集，按“Harness 工程”与“对齐校验”两条线整理。
每条都标注了它在本仓库中的落点。

## A. Harness 工程线

### 1. Effective harnesses for long-running agents（2025-11-26）

- 来源：Anthropic Engineering。
- 核心：长任务跨上下文窗口的 Agent Harness；`Initializer Agent + Coding Agent`
  双 Agent 会话交接；用持久化 Artifact 跨会话传递状态。
- 解决的问题：上下文窗口耗尽、任务中断丢失进度、Agent 过早宣称完成。
- 落地：`feature.registered` 默认失败，`ProgressJournal`、`ArtifactStore`、
  `Session` 账本跨会话持久，`feature.updated` 只有带证据才翻转通过。

### 2. Harness design for long-running application development（2026-03-24）

- 核心：`Planner-Generator-Evaluator` 三 Agent 对抗 Harness，借鉴 GAN 的
  生成-评估分离；解决自我评估偏差与 context-anxiety；sprint 迭代交付，外部环境做客观校验。
- 落地：`ManagedRuntime` 的 `Planner -> Generator -> Evaluator` 循环，
  外部环境校验由 `Sandbox + Probe` 完成，不依赖模型自述。

### 3. Scaling Managed Agents: Decoupling the brain from the hands（2026-04）

- 核心：Managed Agents 架构，大脑（LLM 推理）与手脚（沙盒工具执行）彻底解耦。
  四大组件：`Session`（append-only 事件账本）、`Harness`（编排中枢）、
  `Sandbox`（沙盒）、`Orchestration`（调度）。会话日志独立于模型上下文窗口，
  可回溯、恢复、切片喂给模型。
- 落地：`Session`=`ledger + session`，`Harness`=`orchestrator`，
  `Sandbox`=`sandbox`，`Orchestration`=`authority + oversight + memory`。

## B. 对齐与校验线

### 4. Constitutional AI: Harmlessness from AI Feedback（2022）

- 来源：arXiv:2212.08073。
- 核心：不是 Harness，但定义运行时对齐校验范式，即“模型自我批判-修正闭环”。
- 落地：`constitution.ts` 的 `Principle -> Critic -> Revision` 循环，
  作为运行时证据-校验层的一部分。

## C. 早期基础材料

这些材料不是“四篇核心”，但提供了 Agent 设计的底层原则。

- Anthropic `Building Effective Agents`（2024-12）：augmented LLM、工作流模式、
  环境反馈闭环、简单优先、工具接口设计。
- OpenAI `Practices for Governing Agentic AI Systems`（2023-12）：七条治理实践，
  包括可问责、行动账本、审批门、能力边界、可逆、停机。
- OpenAI `A Practical Guide to Building Agents`（2025）：单/多智能体编排、
  manager 与 decentralized 模式、监督与评测。

## 交汇点

四篇核心论文共同指向一件事：不要只信任模型输出，要用证据、权限、可逆性和外部环境
把自主性框住。AI Time Run 把这一点落到 `State-Evidence-Authority-Coordination`，
并用一条追加式 Session 账本把大脑、手脚、权限、证据和校验共享成同一份事实。
