# ⏱️ AI Time Run

> **Autonomous agents need a ledger they cannot lie in.**

A managed-agent runtime that decouples the brain from the hands and turns every
run into an auditable, event-sourced Episode. Built from the MDIBUS V18
architecture and the 2026 Harness-Engineering papers.

[![Version](https://img.shields.io/badge/version-0.1.0-blue)](package.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)
[![Tests](https://img.shields.io/badge/tests-30%20passing-green.svg)](tests/runtime.test.mjs)
[![Stars](https://img.shields.io/github/stars/MAGA2010/AI-time-run?style=social)](https://github.com/MAGA2010/AI-time-run)

---

## The problem

Long-horizon agents do not fail because the model is weak. They fail because
the runtime around the model is missing.

- 4 hours in, the agent has forgotten what it already verified and does it again.
- The agent declares "done" while the feature is still broken.
- A tool call runs outside its permission boundary and nobody notices.
- After a failure, you cannot tell whether the model, the tool, or the harness
  was at fault.
- A reviewer cannot reconstruct what actually happened from the conversation.

**AI Time Run does not make the model smarter.** It makes the model's work
auditable, verifiable, and reversible — by putting every step on a single
append-only ledger and refusing to trust the model's own word.

---

## How it works

Nine modules, one data flow. A run moves from intent to environment and back,
with human oversight able to intervene anywhere:

```text
01 Principal + Mission
        │
        ▼
02 Cognitive Services ── (plan → simulate → observe)
        │
        ▼
03 MDIBUS Kernel ────── (claim → evidence → causal history)
        │
        ▼
04 Actor Kernel ─────── (identity → lanes → dispatch)
        │
        ▼
05 Capability + Session (trust gateway → authority → isolation)
        │
        ▼
06 Environments / World (filesystem · shell · browser)
        │
        ▼
07 Effect + Verification (checkpoint → actualize → probe → verify)
        │
        ▼
08 Workspace + Memory ── (journal · artifacts · beliefs)
        ▲
        │ evidence / memory feedback
        └────────────────────────────────── 09 Eval + Oversight
```

| Module | Responsibility | Core artifact |
| --- | --- | --- |
| 01 Principal + Mission | Human intent, capability boundary, protected intentions | `mission.created` |
| 02 Cognitive Services | Planning, counterfactual simulation, observation | `plan.recorded`, `simulation.recorded` |
| 03 MDIBUS Kernel | Event-sourced durable semantics, claim vs evidence | `claim.recorded`, `evidence.attached` |
| 04 Actor Kernel | Identity binding, multi-agent lanes, dispatch | `identity.bound` |
| 05 Capability + Session | Semantic trust, authority, fault isolation | `grant.issued`, `approval.granted` |
| 06 Environments | Real filesystem / shell / browser adapters | `FileSystemAdapter` |
| 07 Effect + Verification | Checkpoint, actualize, probe, verify | `effect.verified` |
| 08 Workspace + Memory | Journal, artifacts, failure/episodic memory, beliefs | `ProgressJournal`, `BeliefRouter` |
| 09 Eval + Oversight | Metrics, blind spots, automatic escalation | `oversight.escalated` |

---

## Runtime workflow

The nine modules and the evidence-verified loop are one workflow: modules are
the stages, the loop is the path a feature takes through them, and every step
writes to the shared event ledger.

```mermaid
flowchart TB
  classDef contract fill:#fff7ed,stroke:#ea580c,color:#1f2937;
  classDef gate fill:#eff6ff,stroke:#2563eb,color:#1f2937;
  classDef trace fill:#f0fdf4,stroke:#16a34a,color:#1f2937;
  classDef failure fill:#fef2f2,stroke:#dc2626,color:#1f2937;
  classDef learn fill:#f5f3ff,stroke:#7c3aed,color:#1f2937;
  classDef data fill:#f9fafb,stroke:#9ca3af,color:#1f2937;
  classDef eval fill:#fefce8,stroke:#ca8a04,color:#1f2937;

  subgraph M1["01 Principal + Mission"]
    MISSION["Principal 人<br/>mission.created<br/>意图契约 · 能力边界 · 受保护意图"]
    FEATURE["Initializer<br/>feature.registered<br/>passes = false（默认失败）"]
    COMPULSION["compulsion-log<br/>强制 / 委托日志"]
  end
  subgraph M2["02 Cognitive Services"]
    PLAN["Planner<br/>plan.recorded"]
    CLAIM["Claim<br/>claim.recorded<br/>作者主张 ≠ 真相"]
    SIM["OMEGA 反事实预演<br/>simulation.recorded"]
  end
  subgraph M3["03 MDIBUS Kernel"]
    LOG[("Ledger / SessionEvent<br/>action · tool · context · verification<br/>attribution · intervention · entropy · outcome")]
    CAUSAL["CausalGraph<br/>依赖 / 隔离图"]
    CONJ["ConjectureScheduler<br/>假设 / 信念"]
    POLICY["policy-engine<br/>委托规则即数据"]
    INVARIANT{"validateLedger<br/>防伪不变量"}
  end
  subgraph M4["04 Actor Kernel"]
    IDENTITY["IdentityEngine<br/>identity.bound"]
    HANDSHAKE{"selective handshake<br/>trust-domain 匹配?"}
    CANDIDATE["Generator<br/>candidate.proposed"]
    CRITIC{"Critic / Constitution<br/>critique.recorded"}
    REVISE["revision.requested"]
    CONFLICT["goal-conflict-resolver<br/>冲突容忍 / 降权"]
    COW["COW model state<br/>delta-only fork"]
  end
  subgraph M5["05 Capability + Session"]
    GRANT["grant.issued / revoked"]
    AUTH{"authority.canAct<br/>read / act / oversee"}
    GATE{"高影响 scope?"}
    APPROVE{"Human Approval<br/>granted / denied"}
    ARBITER["evidence-arbiter<br/>真相 / 质量报告者"]
  end
  subgraph M6["06 Environments"]
    REQUEST["effect.requested"]
    CHECKPOINT["checkpoint.created<br/>世界快照"]
    TOOL{"工具存在?"}
    EXEC["Sandbox.execute<br/>effect.actualized"]
    FAULT["故障隔离"]
  end
  subgraph M7["07 Effect + Verification"]
    PROBE{"probe 存在?"}
    EVIDENCE["runProbe<br/>evidence.attached"]
    TRUST{"trust.assessed<br/>可信?"}
    EVALUATE["evaluation.recorded"]
    CHECK{"check.recorded<br/>确定性检查"}
    VERIFIED["effect.verified"]
    VALIDATOR["effect-validator<br/>差异断言"]
    VA["verification autonomy<br/>完成 = 被独立证明"]
  end
  subgraph M8["08 Workspace + Memory"]
    UPDATE["feature.updated<br/>passes=true + evidenceId"]
    BELIEF["belief.asserted"]
    MEMORY["journal / artifact<br/>episodic / failure / belief"]
    WORKSPACE["SelectiveWorkspace<br/>上下文预算 / 黑名单"]
  end
  subgraph M9["09 Eval + Oversight"]
    ROLLBACK["rollback.requested<br/>effect.reverted"]
    FAILURE["failure.attributed<br/>归因分流"]
    F_CONTEXT["F_context"]
    F_TOOL["F_tool"]
    F_FEEDBACK["F_feedback"]
    F_VERIFY["F_verify"]
    F_RECOVERY["F_recovery"]
    F_ENTROPY["F_entropy"]
    F_MODEL["F_model"]
    F_UNKNOWN["F_unknown"]
    ENTROPY["entropy.audited"]
    ESCALATE["oversight.escalated<br/>撤销授权"]
    EVOLVE{"同类失败 ≥ 阈值"}
    AMEND["constitution.amended"]
    INTERVENTION["intervention.recorded<br/>M-HIR / 可否避免"]
    MHIR["M-HIR<br/>avoidable interventions / episodes"]
    BUDGET{"预算门<br/>token / time / cost"}
    EPISODE["Episode package<br/>H0 → H1 → H2 → H3"]
  end
  subgraph RESP["11 Harness Responsibilities"]
    RESPONSIBILITIES["① task ② context ③ tool ④ project memory ⑤ state<br/>⑥ observability ⑦ attribution ⑧ verification<br/>⑨ permissions ⑩ entropy ⑪ intervention"]
  end
  subgraph PRINCIPLES["5 Design Principles"]
    PRINCIPLES5["P1 explicit resources · P2 traceable mediation<br/>P3 requirement verification · P4 attribution before recovery<br/>P5 entropy awareness"]
  end
  subgraph EVALS["OpenAI Evals 评测套件"]
    direction LR
    EVALSET["EvalSet<br/>capability / regression"]
    REGISTRY["Registry<br/>声明式 eval spec"]
    SAMPLE["EvalSample<br/>input · ideal · expected"]
    SOLVER["Solver<br/>runtime 作为被测 Agent"]
    METRIC["Metric<br/>exact-match · token-usage"]
    RUBRIC["model-graded rubric<br/>judge prompt + criteria"]
    RECORDER["Recorder<br/>local · log · postgres"]
    REPORT["Report<br/>pass / diff / regressions"]
  end

  MISSION --> FEATURE --> PLAN --> CLAIM --> HANDSHAKE --> CANDIDATE
  IDENTITY --> HANDSHAKE
  CANDIDATE --> CRITIC
  CRITIC -->|"不通过 & 未超限"| REVISE
  REVISE --> CANDIDATE
  CRITIC -->|"不通过 & 超限"| REJECT["constitution-rejected"]
  CRITIC -->|"通过"| AUTH
  GRANT -.->|"授权数据"| AUTH
  AUTH -->|"无授权 / 已撤销 / 级别不足"| NOCAP["no-grant / revoked / insufficient"]
  AUTH -->|"有授权"| GATE
  GATE -->|"低影响"| REQUEST
  GATE -->|"高影响"| APPROVE
  APPROVE -->|"denied"| APPROVEDENY["approval-denied"]
  APPROVE -->|"granted"| REQUEST
  SIM -.->|"先模拟"| REQUEST
  REQUEST --> CHECKPOINT --> TOOL
  TOOL -->|"否"| MISSINGTOOL["missing-tool"]
  TOOL -->|"是"| EXEC
  EXEC -->|"异常"| FAULT
  EXEC -->|"成功"| PROBE
  PROBE -->|"否"| MISSINGPROBE["missing-probe"]
  PROBE -->|"是"| EVIDENCE --> TRUST
  TRUST -->|"不可信"| ROLLBACK
  TRUST -->|"可信"| EVALUATE
  EVALUATE --> CHECK
  CHECK -->|"否"| ROLLBACK
  CHECK -->|"是"| VERIFIED
  VERIFIED --> UPDATE --> BELIEF --> MEMORY
  MEMORY -.->|"memory feedback"| PLAN
  WORKSPACE -.->|"上下文选择"| PLAN

  FAULT --> ROLLBACK
  MISSINGTOOL --> ROLLBACK
  MISSINGPROBE --> ROLLBACK
  APPROVEDENY --> ROLLBACK
  NOCAP --> ROLLBACK
  REJECT --> ROLLBACK
  ROLLBACK --> FAILURE
  FAILURE --> F_CONTEXT
  FAILURE --> F_TOOL
  FAILURE --> F_FEEDBACK
  FAILURE --> F_VERIFY
  FAILURE --> F_RECOVERY
  FAILURE --> F_ENTROPY
  FAILURE --> F_MODEL
  FAILURE --> F_UNKNOWN
  F_CONTEXT --> EVOLVE
  F_TOOL --> EVOLVE
  F_FEEDBACK --> EVOLVE
  F_VERIFY --> EVOLVE
  F_RECOVERY --> EVOLVE
  F_ENTROPY --> EVOLVE
  F_MODEL --> EVOLVE
  F_UNKNOWN --> EVOLVE
  EVOLVE -->|"yes"| AMEND
  AMEND -.->|"追加原则"| CRITIC
  FAILURE -.-> ESCALATE

  ESCALATE -.->|"oversight"| AUTH
  ESCALATE -.->|"oversight"| PROBE
  ESCALATE -.->|"oversight"| VERIFIED
  FAILURE --> ENTROPY
  EVIDENCE -.-> LOG
  VERIFIED -.-> LOG
  ROLLBACK -.-> LOG
  ENTROPY -.-> LOG
  CONJ -.-> LOG
  LOG -.-> CAUSAL
  LOG -.->|"上下文投影"| PLAN
  MISSION -.-> COMPULSION
  POLICY -.->|"委托规则"| AUTH
  CONFLICT -.->|"降权"| AUTH
  COW -.->|"快照"| CHECKPOINT
  ARBITER -.->|"仲裁"| TRUST
  VALIDATOR -.->|"差异断言"| VERIFIED
  APPROVE -.->|"记录干预"| INTERVENTION
  INTERVENTION -.-> LOG
  LOG --> INVARIANT
  INVARIANT -.->|"violations"| ESCALATE
  MEMORY -.->|"消费预算"| BUDGET
  BUDGET -.->|"耗尽"| ROLLBACK
  VERIFIED --> VA
  MEMORY --> EPISODE
  VA --> EPISODE
  RESPONSIBILITIES -.->|"coverage"| EPISODE
  PRINCIPLES5 -.->|"贯穿"| LOG
  INTERVENTION -.->|"统计"| MHIR
  EVALSET --> REGISTRY --> SAMPLE --> SOLVER --> METRIC --> RECORDER --> REPORT
  RUBRIC --> METRIC
  SOLVER -.->|"驱动被测 feature"| FEATURE
  SOLVER -.->|"读取 evidence"| EVIDENCE
  METRIC -.->|"未达阈值"| ROLLBACK
  REPORT -.->|"回归发现"| ESCALATE
  REPORT -.->|"新约束"| AMEND
  RECORDER -.-> LOG
  REPORT --> EPISODE

  class MISSION,FEATURE,PLAN,CLAIM,REQUEST,CHECKPOINT,EXEC,UPDATE,BELIEF,MEMORY contract;
  class CRITIC,AUTH,GATE,APPROVE,TOOL,PROBE,TRUST,CHECK,EVOLVE,HANDSHAKE,BUDGET,INVARIANT gate;
  class EVIDENCE,VERIFIED,VA,EPISODE trace;
  class REJECT,NOCAP,APPROVEDENY,MISSINGTOOL,FAULT,MISSINGPROBE,ROLLBACK,FAILURE,F_CONTEXT,F_TOOL,F_FEEDBACK,F_VERIFY,F_RECOVERY,F_ENTROPY,F_MODEL,F_UNKNOWN failure;
  class AMEND learn;
  class LOG,CAUSAL,CONJ,IDENTITY,WORKSPACE,SIM,REVISE,GRANT,ENTROPY,ESCALATE,COMPULSION,POLICY,CONFLICT,COW,ARBITER,VALIDATOR,INTERVENTION,MHIR,RESPONSIBILITIES,PRINCIPLES5 data;
  class EVALSET,REGISTRY,SAMPLE,SOLVER,METRIC,RUBRIC,RECORDER,REPORT eval;
```

### Failure modes to harness gates

Each known long-running-agent failure mode is stopped by a specific gate:

```mermaid
flowchart LR
  classDef fail fill:#fef2f2,stroke:#dc2626,color:#1f2937;
  classDef gate fill:#eff6ff,stroke:#2563eb,color:#1f2937;

  FM1["Failure: model declares success\nwithout proof"] --> G1{"Gate: default-FAIL\n+ evidence.attached(ok)"}
  FM2["Failure: tool runs outside its\npermission boundary"] --> G2{"Gate: grant + approval\n+ validateLedger"}
  FM3["Failure: a forged pass or\nunauthorized effect is injected"] --> G3{"Gate: ledger invariants\nreject on replay"}
  FM4["Failure: a tool crashes and\nleaves the world corrupted"] --> G4{"Gate: checkpoint\n+ rollback + fault isolation"}
  G1 --> Loop(["Next unpassed feature"])
  G2 --> Loop
  G3 --> Loop
  G4 --> Loop
  class FM1,FM2,FM3,FM4 fail;
  class G1,G2,G3,G4 gate;
```

---

## V18 primitives mapped to AI Time Run

| MDIBUS module | AI Time Run implementation | Status |
| --- | --- | --- |
| 01 Principal + Mission | `Mission` (protectedIntentions, capabilityBoundary), `AuthorityEngine` grant log | implemented |
| 02 Cognitive Services | `Simulator` (counterfactual), `Planner`, `ObserverBridge`, `Sandbox` | implemented |
| 03 MDIBUS Kernel | `Ledger + project`, `CausalGraph`, `Claim/Evidence/Belief`, `ConjectureScheduler` | implemented |
| 04 Actor Kernel | `Planner/Generator/Critic/Evaluator`, `IdentityEngine` | partial |
| 05 Capability + Session | `TrustGateway`, `AuthorityEngine`, `Sandbox` fault isolation | implemented |
| 06 Environments | `FileSystemAdapter`, `Sandbox` tools | partial |
| 07 Effect + Verification | `checkpoint -> actualized -> probe -> verified/reverted` | implemented |
| 08 Workspace + Memory | `ProgressJournal`, `ArtifactStore`, `EpisodicMemory`, `FailureMemory`, `BeliefRouter`, `SelectiveWorkspace` | implemented |
| 09 Eval + Oversight | `Oversight` (metrics + blindSpots + escalate), approval gates | implemented |

---

## Harness papers mapped

| Paper | Core mechanism | Landing point here |
| --- | --- | --- |
| AI Harness Engineering (2605.13357) | 11 responsibilities, H0-H3 ladder, eight failure classes, Episode package | `episode.ts`, `failure.attributed`, `entropy.audited`, `intervention.recorded` |
| Life-Harness (2605.22166) | Improve frozen models by evolving the runtime interface | `FailureMemory` → reusable constitution principles (roadmap) |
| SafeHarness (2604.13630) | Four defense layers + cross-layer escalation | `authority.ts`, `oversight.escalate()` |
| Effective harnesses for long-running agents | Initializer/Coding split, default-FAIL features | `feature.registered` default `passes:false` |
| Scaling Managed Agents | Session / Harness / Sandbox / Orchestration decoupling | `ledger` + `orchestrator` + `sandbox` + `authority` |
| Constitutional AI | Model self-critique / revision loop | `constitution.ts` Critic → revision |

---

## Runtime command map

| Command | What it does | Artifact |
| --- | --- | --- |
| `ai-time-run demo` | Run the managed-agent demo | `ledger.jsonl` |
| `ai-time-run demo --store ./data` | Run and persist state | `data/ledger.jsonl` |
| `ai-time-run episode` | Print the Episode audit package | JSON |
| `ai-time-run trace --store ./data` | Render a self-contained trace viewer | `data/trace.html` |
| `ai-time-run tamper --store ./data` | Inject forged events to show rejection | `forged-ledger.jsonl`, `forged-trace.html` |

| Role | Responsibility | Must not do |
| --- | --- | --- |
| Principal | Define intent, boundary, approvals, shutdown | Rewrite protected intentions |
| Initializer | Register default-failing features, init environment | Mark anything passing |
| Planner | Pick a feature, decompose steps, write plan + claim | Claim truth without evidence |
| Generator | Produce candidates, request effects | Approve its own work |
| Critic | Review candidates against the constitution | Pass a violating candidate |
| Evaluator | Run probes, attach evidence, verify effects | Pass without `ok:true` evidence |
| Observer | Assess trust, detect blind spots, escalate | Mutate trust from untrusted content |

```bash
# One complete evidence-verified loop
ai-time-run demo --store ./data
ai-time-run episode --store ./data
ai-time-run trace --store ./data
ai-time-run tamper --store ./data
```

---

## 30-second quickstart

```bash
git clone https://github.com/MAGA2010/AI-time-run
cd ai-time-run
npm install
npm run build
npm test

# Run the demo (memory only)
npm run demo

# Run the demo and persist the ledger
node dist/cli.js demo --store ./data

# Inspect the Episode audit package
node dist/cli.js episode --store ./data

# Render a self-contained trace viewer (open data/trace.html in a browser)
node dist/cli.js trace --store ./data

# Show that forged events are rejected by the invariant layer
node dist/cli.js tamper --store ./data
```

The demo runs four features and demonstrates authorized pass, approval gate,
no-capability rejection, approval denial, and one constitutional revision. The
expected output includes `57 events, VALID`, `harness level: H2`, and
`responsibilities: 10/11 covered`.

---

## The design rules (non-negotiable)

1. **Evidence before pass.** A feature can only flip to `passes: true` with an
   `ok: true` evidence event; the model's word is never trusted.
2. **Authority is data.** Grants are events; revocation is a tombstone; nothing
   acts without an active `act`-level grant.
3. **Every step is traceable.** The ledger is append-only and replayable; the
   invariant layer can reject forged events without trusting the writer.
4. **The brain is swappable.** `Reasoner` is the only model-facing seam; the
   harness and sandbox are model-agnostic.
5. **Failures are attributed, then recovered.** A failure gets a classified
   `failure.attributed` event before any rollback.
6. **The hands are isolated.** Tool crashes never reach the brain; effects are
   checkpointed before they run.

---

## Documentation

Full docs live under [docs/](docs/):

- [01-papers.md](docs/01-papers.md) — Anthropic / OpenAI engineering sources
- [02-architecture.md](docs/02-architecture.md) — early architecture notes
- [03-managed-agent-runtime.md](docs/03-managed-agent-runtime.md) — four components + multi-agent loop
- [04-workflow-diagram.md](docs/04-workflow-diagram.md) — full workflow, component, sequence diagrams
- [05-mdibus-mapping.md](docs/05-mdibus-mapping.md) — MDIBUS nine-module mapping
- [06-mdibus-blueprint.md](docs/06-mdibus-blueprint.md) — MDIBUS V18 full blueprint
- [07-harness-papers.md](docs/07-harness-papers.md) — three 2026 arXiv papers deep-dive
- [08-v18-deep-study.md](docs/08-v18-deep-study.md) — complete V18 study notes
- [09-harness-merge.md](docs/09-harness-merge.md) — DeepSeek × ChatGPT/Codex harness merge
- [10-openai-evals.md](docs/10-openai-evals.md) — OpenAI Evals mapped into the runtime

---

## Contributing

Bug fixes, docs improvements, and new harness modules are welcome. The
[design rules](#the-design-rules-non-negotiable) above are the source of truth
for any change. Keep a new module testable and wired into the Episode package.

---

## License

[MIT](LICENSE) — © 2026 MAGA2010

---

## Star history

<a href="https://star-history.com/#MAGA2010/AI-time-run&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=MAGA2010/AI-time-run&type=Date&theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=MAGA2010/AI-time-run&type=Date" />
    <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=MAGA2010/AI-time-run&type=Date" />
  </picture>
</a>
