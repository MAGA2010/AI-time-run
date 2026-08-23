# ⏱️ AI Time Run

> **Autonomous agents need a ledger they cannot lie in.**

A managed-agent runtime that decouples the brain from the hands and turns every
run into an auditable, event-sourced Episode. Built from the MDIBUS V18
architecture and the 2026 Harness-Engineering papers.

[![Version](https://img.shields.io/badge/version-0.1.0-blue)](package.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)
[![Tests](https://img.shields.io/badge/tests-27%20passing-green.svg)](tests/runtime.test.mjs)
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

The nine-module data flow, rendered as a workflow diagram:

```mermaid
flowchart TB
  subgraph S1["01 Principal + Mission"]
    direction LR
    s1a["Principal 人"] --> s1b["mission.created<br/>意图契约 / 能力边界"]
  end

  subgraph S2["02 Cognitive Services"]
    direction LR
    s2a["planning-service<br/>plan.recorded"] --> s2b["OMEGA simulation<br/>simulation.recorded"] --> s2c["observer-monitor<br/>observation"]
  end

  subgraph S3["03 MDIBUS Kernel"]
    direction LR
    s3a["claim.recorded<br/>作者主张 ≠ 真相"] --> s3b["evidence.attached<br/>证据"] --> s3c["causal-history<br/>policy-engine"]
  end

  subgraph S4["04 Actor Kernel"]
    direction LR
    s4a["identity.bound<br/>身份绑定"] --> s4b["lanes / dispatch"] --> s4c["goal-conflict-resolver"]
  end

  subgraph S5["05 Capability + Session"]
    direction LR
    s5a["semantic-trust-gateway"] --> s5b["authority.canAct<br/>grant + approval"] --> s5c["crash-isolation"]
  end

  subgraph S6["06 Environments / World"]
    direction LR
    s6a["FileSystemAdapter<br/>真实文件系统"]
  end

  subgraph S7["07 Effect + Verification"]
    direction LR
    s7a["checkpoint.created"] --> s7b["effect.actualized"] --> s7c["verification-probe"] --> s7d["effect.verified"]
  end

  subgraph S8["08 Workspace + Durable Memory"]
    direction LR
    s8a["SelectiveWorkspace<br/>上下文预算"] --> s8b["journal / artifact / memory"] --> s8c["belief-router"]
  end

  subgraph S9["09 Eval + Human Oversight"]
    direction LR
    s9a["metrics / blind-spot"] --> s9b["oversight.escalated<br/>撤销授权"]
  end

  s1b --> s2a
  s2c --> s3a
  s3c --> s4a
  s4c --> s5a
  s5c --> s6a
  s6a --> s7a
  s7d --> s8a
  s8c -.->|"evidence / memory feedback"| s2c

  s9b -.->|"oversight"| s1a
  s9b -.->|"oversight"| s5a
  s9b -.->|"oversight"| s7a
  s9b -.->|"oversight"| s8a
```

One feature moves through the evidence-verified loop; a feature starts as
`passes: false` and only external evidence can flip it:

```mermaid
flowchart TB
  classDef contract fill:#fff7ed,stroke:#ea580c,color:#1f2937;
  classDef gate fill:#eff6ff,stroke:#2563eb,color:#1f2937;
  classDef trace fill:#f0fdf4,stroke:#16a34a,color:#1f2937;
  classDef failure fill:#fef2f2,stroke:#dc2626,color:#1f2937;

  F["feature.registered<br/>passes = false"] --> P["plan.recorded + claim.recorded"]
  P --> G["candidate.proposed"]
  G --> C{"Critic / Constitution<br/>critique.recorded"}
  C -->|"revise"| G
  C -->|"pass"| A{"Authority.canAct<br/>grant + approval"}
  A -->|"denied"| Deny["no-capability-grant / approval-denied"]
  A -->|"granted"| CK["checkpoint.created"]
  CK --> E["effect.actualized<br/>sandbox + fault isolation"]
  E --> PR{"probe 存在?"}
  PR -->|"no"| RB["rollback.requested"]
  PR -->|"yes"| EV["runProbe → evidence.attached"]
  EV --> TR{"trust.assessed<br/>+ evaluation.recorded"}
  TR -->|"untrusted / failed"| RB
  TR -->|"trusted"| VF["effect.verified"]
  VF --> FU["feature.updated<br/>passes=true + evidenceId"]
  FU --> BL["belief.asserted + memory"]
  RB --> FA["failure.attributed"]

  class F,P,G,CK,E,FU,BL contract;
  class C,A,PR,TR gate;
  class EV,VF trace;
  class Deny,RB,FA failure;
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
