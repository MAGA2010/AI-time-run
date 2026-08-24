/**
 * BREAK 7 — CodeAgent Integration tests
 *
 * Run with `npm test` (after `npm run build`). These tests exercise the new
 * components without requiring a live Python kernel: the CodeActInterpreter
 * is verified in isolation, and the codeagent CLI variants are exercised
 * end-to-end with `kernel-unavailable` failures that the harness records
 * cleanly into the ledger.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import {
  Ledger,
  validateLedger,
  renderTraceHtml,
} from '../dist/index.js';

import {
  CodeActInterpreter,
  extractBlame,
  isLikelySandboxDenied,
  suggestedEscalation,
  parsePatch,
  makeApplyPatchTool,
  SelfDebugLoop,
  Reasoners,
} from '../dist/code/index.js';

function tempStore() {
  const dir = mkdtempSync(join(tmpdir(), 'break7-'));
  return dir;
}

test('CodeActInterpreter registers a dead kernel when python is missing', async () => {
  const dir = tempStore();
  try {
    const interp = new CodeActInterpreter({
      pythonBin: 'python3-does-not-exist-' + Math.random().toString(36).slice(2),
      workspaceRoot: join(dir, 'kernels'),
      cellTimeoutMs: 3000,
    });
    // startFeature triggers the spawn; the ENOENT handler then installs a dead handle.
    await interp.startFeature('f1');
    // Give the 'error' event a tick to fire and swap the handle.
    await new Promise((r) => setTimeout(r, 50));
    const result = await interp.executeCell('f1', 'print(1)');
    assert.equal(result.returncode, -1);
    assert.match(result.stderr, /kernel-unavailable/);
    await interp.shutdown();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('extractBlame parses Python tracebacks into BlockBlame', () => {
  const stderr = 'Traceback (most recent call last):\n  File "foo.py", line 12, in <module>\n  File "bar.py", line 3, in fact\nNameError: x';
  const blame = extractBlame(stderr);
  assert.equal(blame.length, 2);
  assert.equal(blame[0].file, 'foo.py');
  assert.equal(blame[0].startLine, 12);
  assert.equal(blame[1].file, 'bar.py');
});

test('isLikelySandboxDenied matches Codex CLI denial signals', () => {
  assert.equal(
    isLikelySandboxDenied({ ok: false, stderr: 'Operation not permitted (bwrap)' }),
    true,
  );
  assert.equal(isLikelySandboxDenied({ ok: false, stderr: 'random error' }), false);
  assert.equal(isLikelySandboxDenied({ ok: true, stderr: 'Operation not permitted' }), false);
});

test('suggestedEscalation returns danger-full-access only for write/exec scopes', () => {
  assert.equal(
    suggestedEscalation({ ok: false, stderr: 'Operation not permitted' }, 'sandbox.exec'),
    'danger-full-access',
  );
  assert.equal(
    suggestedEscalation({ ok: false, stderr: 'Operation not permitted' }, 'repo.read'),
    'keep-policy',
  );
});

test('parsePatch handles a single-file hunk with markers', () => {
  const patch = `*** Begin Patch
*** Update File: src/auth.ts
@@ line 12
- old token
+ new token
*** End Patch`;
  const parsed = parsePatch(patch);
  assert.equal(parsed.begin, true);
  assert.equal(parsed.end, true);
  assert.equal(parsed.hunks.length, 1);
  assert.equal(parsed.hunks[0].file, 'src/auth.ts');
  assert.equal(parsed.hunks[0].startLine, 12);
  assert.equal(parsed.hunks[0].oldText, 'old token');
  assert.equal(parsed.hunks[0].newText, 'new token');
});

test('apply_patch tool writes files atomically and rolls back on mismatch', () => {
  const dir = tempStore();
  try {
    const target = join(dir, 'auth.ts');
    writeFileSync(target, 'export const auth = jwt.signate();', 'utf8');
    const tool = makeApplyPatchTool(dir);

    const okPatch = `*** Begin Patch
*** Update File: auth.ts
@@ line 1
- export const auth = jwt.signate();
+ export const auth = jwt.sign();
*** End Patch`;
    const good = tool.run({ patch: okPatch });
    assert.equal(good.ok, true);
    assert.deepEqual(good.filesWritten, ['auth.ts']);
    assert.equal(readFileSync(target, 'utf8'), 'export const auth = jwt.sign();');

    const badPatch = `*** Begin Patch
*** Update File: auth.ts
@@ line 1
- export const auth = jwt.doesNotExist();
+ export const auth = jwt.sign();
*** End Patch`;
    const bad = tool.run({ patch: badPatch });
    assert.equal(bad.ok, false);
    assert.equal(bad.rolledBack, true);
    assert.equal(readFileSync(target, 'utf8'), 'export const auth = jwt.sign();');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('SelfDebugLoop writes code.feedback + code.retry events and bails after maxAttempts', async () => {
  const dir = tempStore();
  try {
    const ledger = new Ledger();
    const interp = new CodeActInterpreter({
      pythonBin: 'python3-does-not-exist-' + Math.random().toString(36).slice(2),
      workspaceRoot: join(dir, 'kernels'),
      cellTimeoutMs: 3000,
    });

    // Issue a grant covering sandbox.exec so the validator accepts effect.requested events.
    ledger.append({
      type: 'grant.issued',
      actor: 'principal',
      payload: {
        grantId: 'g-exec',
        actor: 'generator',
        scope: 'sandbox.exec',
        level: 'act',
        issuedBy: 'principal',
        issuedAt: '',
      },
    });
    // Need a parent event id to anchor the chain. Create a fake failure first.
    const parent = ledger.append({
      type: 'failure.attributed',
      actor: 'evaluator',
      payload: { featureId: 'fix-x', failureType: 'verify' },
    });

    const loop = new SelfDebugLoop(
      ledger,
      interp,
      {
        explain: async () => 'the cell crashed',
        refine: async () => 'print("retry")',
      },
      { maxAttempts: 2 },
    );

    const outcome = await loop.run({
      featureId: 'fix-x',
      reason: 'unit-test',
      trace: 'NameError',
      parentEventId: parent.id,
    });

    assert.equal(outcome.ok, false);
    assert.equal(outcome.attempts, 2);
    assert.equal(ledger.byType('code.feedback').length, 2);
    assert.equal(ledger.byType('code.retry').length, 2);
    assert.equal(ledger.byType('effect.requested').length, 2);
    assert.equal(validateLedger(ledger).ok, true);
    await interp.shutdown();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('BaseReasoner emits pseudo-code style steps', () => {
  const reasoner = Reasoners.makeBaseReasoner();
  const mission = {
    id: 'm',
    goal: 'search and execute',
    protectedIntentions: [],
    capabilityBoundary: ['repo.read', 'sandbox.exec'],
    approvalThreshold: 'high-impact',
  };
  const plan = reasoner.plan(mission, [{ id: 'f1', description: 'search for factorial and execute it', steps: [] }], '');
  assert.ok(plan.steps.length > 0);
  assert.ok(plan.steps.some((s) => s.includes('code.search') || s.includes('code.repl')));
});

test('QAReasoner piggybacks a QA-Checker verdict on the critique lane', async () => {
  const verdicts = [];
  const reasoner = Reasoners.makeQAReasoner({
    onQACheck: (v) => verdicts.push(v),
    minAlignment: 0,
  });
  const critique = await reasoner.critique(
    { id: 'c1', planId: 'p1', content: 'plan A' },
    [{ id: 'safe', statement: 'must be safe' }],
    '',
  );
  assert.ok(Array.isArray(critique));
  assert.equal(verdicts.length, 1);
  assert.equal(verdicts[0].candidateId, 'c1');
});

test('renderTraceHtml highlights code.* events with the .code-event class', async () => {
  const ledger = new Ledger();
  ledger.append({ type: 'mission.created', actor: 'principal', payload: { mission: { id: 'm' } } });
  ledger.append({
    type: 'code.executed',
    actor: 'evaluator',
    payload: { featureId: 'f1', stdout: 'ok', stderr: '', returncode: 0 },
  });
  const html = renderTraceHtml(ledger, { title: 'BREAK 7 test' });
  assert.match(html, /row code-event/);
});


