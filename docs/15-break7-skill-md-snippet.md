# BREAK 7 — Skill wrapper upgrade snippet

> The runtime cannot overwrite the user's Codex skill file
> (`C:\Users\华为\.codex\skills\ai-time-run\SKILL.md`). Paste the
> snippets below into that file at the indicated anchors to enable
> BREAK 7 triggers. The wrapper itself remains the same — only its
> description, CLI surface, and variant table change.

## 1) Replace the front-matter `description` (line 3)

Replace the existing `description: ... Keywords: ...` value with the
one below to add CodeAgent triggers to the skill header.

```yaml
description: Evidence-verified, event-sourced runtime for long-horizon autonomous agents and CodeAgent-style software engineering. Use when a Codex task is long-horizon, multi-step, repo-level, or has to be auditable end-to-end - the runtime records every plan / claim / effect / evidence / failure / code-cell to an append-only ledger, refuses to pass without ok:true evidence, and renders a self-contained trace.html. BREAK 7 adds a Jupyter-style Python kernel (CodeAct), 5 CodeAgent tools (search / doc / symbol_nav / format / apply_patch), a rubber-duck self-debug loop, QA-Checker multi-agent reasoning, and Permission-Inversion sandbox heuristics. Invoke via the local CLI in `D:\personal skill\ai-time-run\dist\cli.js`. Keywords: audit trail, ledger, MDIBUS, episode package, trace viewer, tamper-evident, evidence before pass, codeagent, codeact, self-debug, code interpreter, symbol navigation, pseudo-code plan, multi-agent code review, AGENTS.md, sandbox escalate, apply-patch.
```

## 2) Append the `codeagent` command to the CLI surface block

After the existing `tamper` line in the `CLI surface` fenced block, add:

```bash
# BREAK 7: run a CodeAgent scenario (CodeAct + 5 tools + SelfDebugLoop + QA-Checker).
# Requires Python 3 on PATH (or set AI_TIME_RUN_PYTHON=python).
node "D:\personal skill\ai-time-run\dist\cli.js" codeagent [--variant codeact|self-debug|qa-review] [--store <dir>]
```

## 3) Insert a new section right before `## How to apply the skill to a Codex task`

```markdown
## CodeAgent variants (BREAK 7)

When the user request matches any CodeAgent trigger (repo-level code, fix this bug, run the tests, symbol navigation, self-debug, code review, multi-agent), choose a variant:

| Variant | Tool set | Reasoner | When |
| --- | --- | --- | --- |
| `codeact` | code.repl + code.search + code.symbol_nav + code.doc + code.format | PseudoCodeReasoner (or SelectorReasoner) | Plan + execute + verify a Python computation in a stateful kernel. |
| `self-debug` | code.repl | base + SelfDebugLoop (3 attempts, rubber-duck explanations) | First cell fails; refine + retry before rollback. |
| `qa-review` | all 6 tools + code.repl | QAReasoner (adds QA-Checker lane) | Multi-agent code review; QA-Checker cross-validates the critic. |

After choosing a variant, run the `codeagent` CLI command with `--store <dir>`. The ledger gains BREAK 7 events (`code.executed`, `code.feedback`, `code.retry`, `code.plan_recorded`, `code.symbol_resolved`, `code.apply_patch`, `code.escalate`); `trace --store <dir>` highlights them in indigo.

**Optional dependency**: Python 3.10+ on PATH for `code.repl`. Without it, the interpreter registers a synthetic dead kernel and the demo still runs end-to-end with structured `kernel-unavailable` failures recorded in the ledger (so the harness remains auditable).
```

## 4) Append to the `## Failure modes` list

```
- (BREAK 7) If `python3` is not on PATH, `code.repl` returns structured `kernel-unavailable` failures into the ledger - the demo still completes. Install Python 3.10+ or set `AI_TIME_RUN_PYTHON=path\to\python.exe` to enable real execution.
```

---

After pasting these snippets, restart Codex so the new keywords are
picked up by the skill matcher. Confirm with `node "D:\personal
skill\ai-time-run\dist\cli.js" help` that the `codeagent` line is
visible.
