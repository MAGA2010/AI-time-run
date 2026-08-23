# 四篇论文综合

本文把 OpenAI 与 Anthropic 的四篇核心材料浓缩为可以直接落地的设计原则，并标注
每条原则在本仓库中的落点。

## 1. Anthropic — Building Effective Agents（2024-12）

核心结论：成功团队几乎都不用复杂框架，而是用简单、可组合的模式。

- `augmented LLM`：检索、工具、记忆是基础构件。
- 工作流模式：链式提示、路由、并行（切分/投票）、编排者-工作者、评估者-优化器。
- `agent`：让模型依据**环境反馈**在循环中自己决定下一步。
- 三个原则：保持简单、显式展示规划、精心设计工具接口（ACI）。

落地：本仓库把“环境反馈”固化为 `probe -> evidence` 事件，而不是让模型自述成功。

## 2. Anthropic — Effective Harnesses for Long-Running Agents（2025-11）

核心结论：长周期 Agent 的难点不是单窗口内推进，而是跨窗口交接。解法是
`initializer agent` + `coding agent`。

- `initializer`：写功能清单、进度日志、`init.sh`、首次 git 提交。
- 功能清单：每个功能默认 `passes: false`，后续只能改状态，不能删测试。
- `coding agent`：每次只做一个功能，结束时留下干净的提交和进度更新。
- 验证：明确要求用浏览器自动化做端到端验证，而不是只看代码。

落地：本仓库的 `feature.registered` 默认失败，`feature.updated` 只有带证据才翻转为通过。

## 3. OpenAI — Practices for Governing Agentic AI Systems（2023-12）

核心结论：agentic 系统的治理需要七条实践。

1. 明确问责：每次未补偿的直接伤害都有可追责的人类主体。
2. 行动账本：给用户提供 Agent 行动的记录。
3. 人工审批门：重大决策先经人审。
4. 能力边界：限制早期部署的影响范围。
5. 分阶段部署：逐步放量并监控。
6. 可逆设计：尽可能让行动可回滚。
7. 停机能力：可靠的关闭机制。

落地：`ledger` 是行动账本；`authority` + `approval` 是审批门；`mission.capabilityBoundary`
是能力边界；`checkpoint + rollback` 是可逆；`shutdown.requested` 是停机。

## 4. OpenAI — A Practical Guide to Building Agents（2025）

核心结论：先判断是否需要 Agent，再选单智能体还是多智能体。

- 单智能体：规划、执行、记忆、迭代。
- 多智能体：`manager`（主管）模式与 `decentralized`（去中心化）模式。
- 工具设计、护栏、人工监督与评测贯穿始终。

落地：本仓库目前是单运行时 + 多个具名角色（`principal/initializer/coding/verifier`），
为后续接入 manager 与去中心化 Actor 预留了身份和车道边界。

## 交汇点

四篇论文共同指向同一件事：**不要只信任模型输出，要用证据、权限和可逆性把自主性框住**。
AI Time Run 把这一点落到“追加式事件账本”上，让证据、权限、效应和校验共享同一份事实。
