---
title: BREAK 7 Deep Study — CodeAgent Internals & Implementation Reality
status: v1
date: 2026-08-24
parent: docs/14-codeagent-study-notes.md
audience: authors of src/code/** + future v0.2 contributors
key_finding: |
  OpenAI actual Code Interpreter is more layered than the academic CodeAct
  abstraction; JoyCode Fail2Pass/Pass2Pass is the single most valuable
  algorithm to copy; SWE-Agent linter-guarded edit is the cheapest single
  improvement to code.apply_patch.
---

# BREAK 7 Deep Study — CodeAgent Internals & Implementation Reality

> Second-pass deep dive. docs/14 was breadth; this doc is depth: actual
> algorithms, actual prompt templates, reverse-engineered architecture,
> actual cost numbers.

## Table of contents

1. CodeAct training methodology (MINT framework)
2. OpenAI Code Interpreter / Coworker reverse engineering
3. SWE-Agent ACI: prompts, linter-guarded edit, history policy
4. JoyCode: Fail2Pass / Pass2Pass / CSR / Decision-voting
5. mini-SWE-agent at $0.07/issue
6. What this means for ai-time-run BREAK 7
7. What we still dont know

---

## 1. CodeAct training methodology (MINT framework)

Source: Wang et al., ICML 2024 (arXiv:2402.01030). Section 3 of the paper.

### 1.1 MINT in one sentence

Multi-turn INteractive code execution with Tools — a training method that
produces trajectories where every agent action is an executable Python
snippet, the interpreters stdout/stderr feeds back as the next observation,
and the agent can import any PyPI package available in the sandbox.

### 1.2 Trajectory collection

- Source problems: 1k tasks sampled from HumanEval / MBPP / Numpy / Torch /
  Pandas test suites.
- Trajectory generator: GPT-4 (gpt-4-0613) prompted with MINT system prompt
  + few-shot exemplars.
- Rollouts per problem: 5.
- Total corpus: ~7k trajectories.

### 1.3 Three-step quality filter

| # | Filter | Acceptance | Failure action |
| --- | --- | --- | --- |
| 1 | Syntactic — parses as Python | All exec() calls succeed | Drop |
| 2 | Execution — every code cell runs | No traceback in final 3 cells | Drop |
| 3 | Correctness — final output matches ground-truth | Unit-test passes | Drop |

Only step-3 survivors become CodeActInstruct. Rejection rate at step 2 is
~60%, step 3 drops another ~30%.

### 1.4 Why code-as-action beats text-as-action

| Action shape | Pros | Cons | Verdict |
| --- | --- | --- | --- |
| JSON | Structured | No control flow | ReAct baseline |
| Text | Natural language | Loses precision | ReWOO baseline |
| Code | Control flow + variable reuse + auto-error feedback | Requires sandbox | +20% on HotpotQA |

The auto-error feedback point is under-appreciated: every time the agents
Python cell raises, the traceback is appended to the observation for free.
This is why src/code/self_debug.ts is a thin wrapper, not a separate agent.

### 1.5 CodeActInstruct statistics

- ~7k accepted trajectories, ~50k (prompt, code, output) triples
- Python only
- Avg 4.2 turns per trajectory (range 1–18)
- Avg 6.4 lines of code per turn
- Top-10 PyPI packages cover 71% of cells (numpy, pandas, requests, json,
  re, itertools, collections, math, random, os)

### 1.6 Takeaways for ai-time-run

1. src/code/interpreter.ts is correctly thin — CodeActs thesis is that the
   interpreter does the work, the LLM just writes code.
2. PseudoCodePlan should default to Pythonic syntax, not free-form English,
   when we move beyond NLP-style steps.
3. We should add a code.feedback cell type that carries the raw traceback
   into the ledger.

---

## 2. OpenAI Code Interpreter / Coworker reverse engineering

Sources: ryan.govost.es reverse engineering, OAI docs, x.com/_catwu,
x.com/benhylak. This is the most important section.

### 2.1 What "Code Interpreter" actually is

| Product | Container | Languages | Audience |
| --- | --- | --- | --- |
| ChatGPT Advanced Data Analysis | gVisor + python3 + Jupyter NB | Python | ChatGPT Plus |
| ChatGPT Coworker (2025) | CUA + LibreOffice + WASM | Multi-format | Coworker subscribers |
| Codex CLI | Local Node + sandboxed shell | Any | Pro / Team |
| API code_interpreter tool | Hosted container | Python | API customers |

src/code/interpreter.ts matches the API tool. It would need rework to
match the in-chat Jupyter UI.

### 2.2 Container entrypoint (legacy Code Interpreter)

```
PID 1: tini (reaper)
CMD: uvicorn server:app --host 0.0.0.0 --port 8080
```

FastAPI exposes: GET /health, GET /config, POST /upload, GET /download/{id},
WebSocket /channel, GET /logs, GET /metrics, GET /containers, GET /files.

### 2.3 WebSocket /channel protocol

```jsonc
// User -> container
{ "type": "exec", "code": "import pandas as pd\n...", "kernel_id": "k-7f3a" }

// Container -> user (streamed)
{ "type": "stdout", "chunk": "...", "kernel_id": "k-7f3a" }
{ "type": "stderr", "chunk": "...", "kernel_id": "k-7f3a" }
{ "type": "result", "ok": true, "files": [...], "elapsed_ms": 1287 }
```

Important caveat (per the ryan.govost.es post): chat sessions do not use a
true Jupyter kernel. When a chat reloads, the container reruns the entire
nbconvert --to script output as subprocess.run(python_file). State is
file-based, not in-memory.

### 2.4 Trade-off table

| Approach | Pros | Cons |
| --- | --- | --- |
| In-memory kernel (ours) | Fast subsequent calls; true REPL | Crashes lose state |
| File-replay (OAI legacy) | Cheap to restart; easy to debug | Every cell reruns |
| Hybrid (proposed) | Best of both | More code; state-sync bugs |

Recommendation for v0.2: add a state-snapshot to .aitr-snap.json after each
cell. On reload, replay the snapshot rather than re-executing.

### 2.5 The Coworker stack (2025)

Per OAIs "What is Coworker?" blog + Walnut repo hints:

- .NET 9 for the XML/object model layer normalizing every office format
  into a common AST (oai.xml).
- C# wrapper around OpenXML SDK — the "trust the format" layer.
- WebAssembly for client-side rendering of generated artifacts.
- Bun runtime for telemetry / metrics shipping.
- Protobuf intermediate format: OOXML -> Protobuf -> OOXML. Every edit
  round-trips through this IR.
- "Paranoia-driven development": for high-stakes deliverables, Coworker
  renders the docx -> pdf -> png, then runs a vision model on the PNG to
  audit "did we actually produce what the user asked for?".
- LibreOffice headless for any non-Office format conversion.

### 2.6 The PPTX Singularity

"Excel now borrows PowerPoints rendering engine for in-cell previews."
Lesson: Coworker treats all office formats as one. There is no separate
"Excel formatter" and "PPT formatter" — there is one renderer that takes
Protobuf in, OOXML out.

This validates our WorkspaceManifest abstraction in src/types.ts — keeping
file-type awareness out of the kernel lets us add formats later without
re-architecting.

### 2.7 combined_apply_patch_cli.py — OAIs edit tool

The Coworker agent uses this ~400-line Python script for file edits. It
uses a regex-based Begin Patch / @@ / + ADD / - DELETE / UPDATE syntax,
similar in spirit to our apply_patch tool but more permissive (allows fuzzy
line matching with context windows).

Our code.apply_patch tool is stricter (exact context match). That is safer
but more brittle on whitespace changes. Worth a fuzzy-mode flag in v0.2.

### 2.8 Takeaways for ai-time-run

1. We are API-tool-shaped, not legacy-ChatGPT-shaped. Fine — most users
   will be calling us programmatically.
2. The Coworker "PPTX Singularity" validates our manifest abstraction.
3. Add state-snapshot to .aitr-snap.json — small change, big durability win.
4. Add vision-audit verifier for high-stakes deliverables (matches our
   existing Verifier integration; Coworker reference makes the why concrete).

### 2.9 Proposed snapshot format (v0.2 candidate)

```jsonc
// .aitr-snap.json — written after each cell
{
  "kernel_id": "k-7f3a",
  "globals": {
    "df": {"_repr": "DataFrame", "path": "/state/df.parquet", "sha256": "..."},
    "model": {"_repr": "sklearn.linear_model.LogisticRegression", "path": null, "sha256": null}
  },
  "cell_count": 17,
  "snapshot_at": "2026-08-24T01:23:45Z"
}
```

Large objects are pickled + SHA-256 to disk; small ones inline. On reload,
CodeActInterpreter first replays the snapshot, then patches in any delta
from the cell log.

---

## 3. SWE-Agent ACI: prompts, linter-guarded edit, history policy

Sources: Princeton-CTG/swe-agent GitHub repo + NeurIPS 2024 paper.
ACI = Agent-Computer Interface — the shape of the tools + docstrings +
system prompt framing.

### 3.1 The ACI thesis

Princetons finding: an agents ceiling is set by the ACI, not by the model.
Improving the ACI gives larger gains than scaling the model itself.
This is the strongest empirical argument for the BREAK 7 tool design.

### 3.2 Tool inventory (SWE-Agent v1.0)

| Tool | Args | Notes |
| --- | --- | --- |
| find_file | filename, dir | rg-style filename search |
| search_dir | search_term, dir | ripgrep with context |
| search_file | search_term, file | per-file grep |
| open_file | path, line_number | 100-line window; line-by-line |
| scroll_up / scroll_down | lines=10 | incremental viewing |
| edit_file | path, view_range, replacement | the linter-guarded edit |
| create_file | path, content | overwrite |
| submit | (none) | end of episode |
| execute_python | code | sandboxed subprocess |
| ask_question | question | interrupt; wait for human |

### 3.3 The linter-guarded edit (the killer feature)

edit_file does not just string-replace. It runs flake8 / mypy / project
linter on the file after the edit; if the linter complains about lines
outside the edited hunk, the edit is rejected with the linter error
appended to the observation. This prevents the classic failure where the
agent fixes a typo but introduces an unused variable three lines below.

Algorithm (our paraphrase of the editor.py flow):

1. Read the file.
2. Apply the requested edit.
3. If no-op -> return Error.
4. Write the file.
5. Run the linter.
6. If linter errors exist outside the view_range -> rollback + return Error.
7. Otherwise return Success.

This is the single cheapest improvement to BREAK 7 code.apply_patch.
Estimated 30 lines of TS. Should land in v0.2.

### 3.4 History truncation policy

SWE-Agent keeps a fixed-window observation history: only the last N=20
observations are in-context. Older observations are summarized into a
single "history summary" string at 80% of the window. This is more
aggressive than naive truncation and empirically beats it because the
summary preserves error chains ("we tried X, got Y, then tried Z, got W").

Our src/types.ts ledger already keeps the full history; the question is
what we surface to the LLM. Currently we surface all events as XML in
the prompt. A v0.2 change: add an ObservationCompressor that produces
the 80% window summary for prompt construction.

### 3.5 Configuration shape

SWE-Agents config exposes per_instance_cost_limit (bail-out budget),
a Docker image reference for the instance environment, and an explicit
tool allow-list. We do not have an equivalent in src/code/ yet — we
should add code.maxBudgetUsd in v0.2.

### 3.6 System prompt characteristics

The system prompt is short. The model is GPT-4o-class; the system prompt
does not over-explain. Lesson for us: our BREAK 7 reasoner prompts should
be similarly terse.

### 3.7 Public benchmark numbers

| Benchmark | Score |
| --- | --- |
| SWE-bench Lite | 65.6% |
| SWE-bench Verified | 51.0% (older eval) |
| HumanEvalFix (bash) | 96.3% |
| InterCode-CTF | 45.0% |

Newer SWE-Agent versions (with GPT-5-class models) hit ~75% on Verified.

### 3.8 Takeaways for ai-time-run

1. Add linter-guarded edit to code.apply_patch — 30 lines, big win.
2. Add code.maxBudgetUsd per-episode budget.
3. Add ObservationCompressor for prompt construction.
4. Tighten BREAK 7 reasoner prompts.

---

## 4. JoyCode: Fail2Pass / Pass2Pass / CSR / Decision-voting

Sources: arXiv:2503.13590 (March 2025) + github.com/jd-opensource/joycode-agent.
JoyCode is the single most influential non-academic CodeAgent of 2025 for
our purposes; the test-generation algorithm is the key takeaway.

### 4.1 Why JoyCode matters

On SWE-bench Verified:

| System | Pass@1 |
| --- | --- |
| SWE-Agent | 51.0% (NeurIPS 2024) |
| JoyCode (March 2025) | 74.6% |
| mini-SWE-agent | 75.80% |

JoyCode is open source, BSD-3, and the per-trajectory algorithm is
documented in the public paper.

### 4.2 The 4-agent orchestration

- Testing Agent — generates Fail2Pass + Pass2Pass tests.
- Patch Agent — produces candidate code edits, validated against the tests.
- CSR Agent (Code-Context Similarity Retrieval) — looks up historically
  successful trajectories in the pool, surfaces as few-shot exemplars.
- Decision Agent — scores each candidate patch and votes.

### 4.3 Fail2Pass / Pass2Pass — the algorithm

Goal: produce tests that prove the bug exists and prove the fix works,
without relying on the projects existing test suite (which may not cover
the bug).

Three required test types per issue:

1. Failure scenario — fails on HEAD, passes on the fix.
2. Happy path — passes on both.
3. Edge case — passes on both (catches regressions in adjacent code).

The pre-validation step is what makes this work: every synthesized test
is run against the current code before being recorded. If it doesnt
fail-on-HEAD when it should (or doesnt pass-on-HEAD when it should), the
test is discarded — not stored as "expected to fail". This prevents the
failure-mode where the agent marks everything as "expected to fail" and the
patch "passes" vacuously.

### 4.4 CSR — Code-Context Similarity Retrieval

Pool of historical successful trajectories. Each entry is pre-embedded
(BAAI/bge-large-en-v1.5 per the JoyCode config). At query time, the agent
computes the embedding of the issue description and retrieves the top-k
most similar trajectories above a 0.65 cosine threshold.

Three-field trajectory compression:

- Strategy — high-level approach (1 sentence).
- Key change — exact lines added/removed (5-10 lines).
- Insight — the why (1-2 sentences).

### 4.5 Decision Agent voting

Five-factor weighted score (JoyCode publishes these weights in the repo):

- correctness: passed.count(True) / len(tests) — weight 0.5
- minimality: 1.0 - (patch.diff_size / 1000) — weight 0.2
- risk: 1.0 - patch.touches_protected_files — weight 0.15
- code_quality: linter_score(patch) — weight 0.1
- test_coverage: covered_lines(patch, tests) / total_lines(patch) — weight 0.05

Correctness dominates (50%), minimality matters (20%), risk and
code-quality are tiebreakers. Test coverage is barely weighted because
Fail2Pass already enforces the most important coverage.

### 4.6 Trajectory compression for the pool

Every accepted trajectory is post-processed into the 3-field summary and
added to trajectories/pool.jsonl. The pool grows over time. The CSR
retriever re-embeds incrementally — no full reindex.

### 4.7 Docker-isolated environment

JoyCode runs every Patch Agent episode in a Docker container matching
the SWE-bench image for the instance (Python version, system libs, etc.).
This is mandatory for SWE-bench Verified scoring — running on the host
gives wrong results. Our CodeActInterpreter does not have a Docker wrapper
today; v0.2 candidate.

### 4.8 Performance breakdown (from JoyCode paper)

On SWE-bench Verified:

| Component | Marginal contribution |
| --- | --- | --- |
| Base Patch Agent | 51.0% |
| + Testing Agent (Fail2Pass/Pass2Pass) | +12.4% |
| + CSR | +6.1% |
| + Decision voting | +3.8% |
| + Trajectory compression | +1.3% |
| Total | 74.6% |

### 4.9 Takeaways for ai-time-run

1. Add a Testing Agent that emits Fail2Pass + Pass2Pass tests — single
   biggest ROI improvement. Estimated 200 lines of TS. Land in v0.2.
2. Add CSR — needs a trajectory pool. Bootstrapping is the hard part.
   Defer to v0.3 unless we can seed it from the existing docs/ archive.
3. Decision voting fits our SelectorReasoner — adopt the 5-factor weighted
   score.
4. Add Docker isolation as opt-in (code.docker=true) — keep the
   Python-subprocess default for fast demos.

---

## 5. mini-SWE-agent at $0.07/issue

Sources: Klavier/mini-SWE-agent GitHub repo, MiniMax M2.5 announcement
(August 2025), Princeton-CTG collaboration post. The most
counter-intuitive result of 2025.

### 5.1 The numbers

- Model: MiniMax M2.5 (open-source, ~7B active params, MoE 64B total)
- Cost: $0.07 / issue (incl. infra)
- Score: 75.80% Pass@1 on SWE-bench Verified
- Comparison: SWE-Agent + GPT-4o = 51.0% at ~$0.50 / issue

A small open model beats a large proprietary model at 1/7 the cost.

### 5.2 What changed

Three things, all on the harness side, not the model:

1. Single-tool ACI — mini-SWE-agent uses a deliberately minimal tool
   set: read_file, edit_file, bash, submit. No search_dir, no scroll,
   no execute_python.
2. Bash-as-tool — every action is a bash command. The model decides
   whether to cat, sed, or python -c "...". This collapses the "tool
   selection" problem into "shell command generation".
3. Aggressive context management — observations are summarized every
   5 turns; the model only sees the last 3K tokens of context.

### 5.3 Cost breakdown ($0.07 / issue)

| Component | Cost |
| --- | --- |
| M2.5 inference (avg 4.2K input + 1.8K output x 12 turns) | $0.04 |
| Docker container time (avg 3.5 min x $0.002/min) | $0.007 |
| Storage + bandwidth | $0.003 |
| Orchestration + retries | $0.020 |
| Total | $0.07 |

### 5.4 What M2.5 itself is

- Architecture: MoE, 7B active / 64B total, fine-tuned on code +
  agentic data.
- Training data: 1.2T tokens, 38% agentic trajectories (CodeActInstruct
  + SWE-bench trajectories + custom rollouts).
- Distillation: from M2-Pro (proprietary) into M2.5.
- Inference: vLLM + custom kernel; 30K tokens/sec on H100.

### 5.5 Counter-intuitive lesson

The harness matters more than the model.

Princeton measured: for the same model, switching from SWE-Agents ACI
to mini-SWE-agents ACI lifted score from 51.0% to 63.4% (no model
upgrade). The remaining +12.4% came from the model upgrade itself.

### 5.6 Takeaways for ai-time-run

1. Consider adding a --variant mini CLI flag that uses a deliberately
   minimal tool set (just bash + read + edit). Unlocks the "cheap" lane.
2. Adopt aggressive context summarization — the verifier needs the full
   ledger; the model only needs the digest.
3. Document cost assumptions — every v0.2 demo should print $X.XX /
   episode based on the configured model + observed tokens.

---

## 6. What this means for ai-time-run BREAK 7

Concrete change list, prioritized by ROI:

| # | Change | Source | Lines | Priority |
| --- | --- | --- | --- | --- |
| 1 | Linter-guarded edit in code.apply_patch | SWE-Agent | 30 | P0 |
| 2 | Fail2Pass / Pass2Pass Testing Agent | JoyCode | 200 | P0 |
| 3 | code.maxBudgetUsd per-episode budget | SWE-Agent | 15 | P1 |
| 4 | Snapshot-based state replay in CodeActInterpreter | OAI legacy | 80 | P1 |
| 5 | ObservationCompressor for prompt construction | SWE-Agent | 60 | P1 |
| 6 | 5-factor Decision voting weights in SelectorReasoner | JoyCode | 25 | P1 |
| 7 | code.feedback event type carrying traceback directly | CodeAct | 15 | P2 |
| 8 | Fuzzy-match mode in code.apply_patch | OAI Coworker | 40 | P2 |
| 9 | Docker isolation as opt-in (code.docker=true) | JoyCode | 100 | P2 |
| 10 | --variant mini minimal-tool CLI flag | mini-SWE-agent | 50 | P3 |

Recommended v0.2 sequence (1 week of focused work):

- Day 1: items 1, 3 (linter guard + budget) — both small, tests-trivial.
- Day 2-3: item 2 (Testing Agent) — needs a sample SWE-bench-like fixture.
- Day 4: items 6, 7 (Decision voting + feedback event).
- Day 5: items 4, 5 (snapshot + compressor) — needs Interpreter refactor.
- Stretch: items 8-10.

---

## 7. What we still dont know

Open questions for v0.3+:

1. OAIs actual Responses API code_interpreter tool JSON schema — docs
   page lists the high-level shape but the exact container-resource
   envelope is undocumented. Need to capture live requests.
2. SWE-Agents exact observation summary prompt — the paper mentions
   "80% window" but not the summary prompt template.
3. JoyCodes trajectory pool seed data — they dont release it; CSR
   without a seed pool is just retrieval over empty.
4. mini-SWE-agents exact context-summarization prompt — repo has
   heuristics but the prompt template is private.
5. How OAI handles multi-user file isolation in the legacy container —
   file paths in /home/sandbox/ are per-user; the isolation boundary
   is unclear.
6. Whether protectedIntentions (our invariant layer) maps cleanly to any
   academic framework — feels related to Constitutional AIs "self-critique"
   but the alignment literature is sparse.

---

## Appendix A: Tool inventory at a glance

| Tool / feature | mini-SWE-agent | SWE-Agent | JoyCode | OAI Code Interpreter | ai-time-run v0.1 |
| --- | --- | --- | --- | --- | --- |
| read_file | yes | yes (open_file) | yes | yes | yes (code.search) |
| edit_file | yes (sed) | yes (linter-guarded) | yes | yes | yes (code.apply_patch) |
| bash | yes | yes | yes | yes | partial (code.repl is Python only) |
| find_file | via bash rg | yes | yes | yes | yes (code.search) |
| submit | yes | yes | yes (via Decision) | implicit | yes (code.feedback) |
| State snapshot | no | no | no | yes (file-replay) | no (v0.2 candidate) |
| Linter-guarded edit | no | yes | yes | no | no (v0.2 P0) |
| Auto tests | no | no | yes | no | no (v0.2 P0) |
| Budget cap | no | yes | yes | yes (token-based) | no (v0.2 P1) |
| Multi-tool voting | no | no | yes | no | yes (SelectorReasoner v1) |
| CSR retrieval | no | no | yes | no | no (v0.3) |

---

## Appendix B: Source links

| Topic | Source | URL |
| --- | --- | --- |
| CodeAct (MINT) | Wang et al. ICML 2024 | arxiv.org/abs/2402.01030 |
| CodeActInstruct dataset | Wang et al. | huggingface.co/datasets/CodeActAgent/CodeActInstruct |
| OAI Code Interpreter reverse | ryan.govost.es | ryan.govost.es/the-code-interpreter/ |
| OAI Coworker internals | OAI blog + catwu tweets | x.com/_catwu |
| SWE-Agent ACI | Princeton CTG | swe-agent.com |
| JoyCode paper | JD Open Source | arxiv.org/abs/2503.13590 |
| JoyCode repo | JD Open Source | github.com/jd-opensource/joycode-agent |
| mini-SWE-agent | Klavier / MiniMax | github.com/klavier-not-found/mini-swe-agent |

---

*End of docs/17. v0.2 planning should start from section 6.*