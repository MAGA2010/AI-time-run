/**
 * BREAK 7 v0.2 — tests for all 10 roadmap items from docs/17 section 6.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import {
  linterGuardedEdit, noopLinter, regexLinter,
  generateFail2PassTests,
  makeEpisodeBudget,
  writeSnapshot, readSnapshot, capturePrimitives,
  compressObservations,
  scorePatch, voteBest, JOYCODE_WEIGHTS,
  buildFeedbackEvent, isNameError, isImportError,
  fuzzyFind, applyFuzzy,
  isDockerAvailable, dockerRunPython,
  makeMiniVariant, makeMiniEditFile, makeMiniToolSet,
  makeApplyPatchTool,
} from '../dist/code/index.js';

function tempDir() { return mkdtempSync(join(tmpdir(), 'break7v02-')); }

// === P0-1 linter-guarded edit ===
test('P0-1: linterGuardedEdit rejects edit when linter finds new errors outside range', async () => {
  const dir = tempDir();
  writeFileSync(join(dir, 'hello.py'), 'x = 1\ny = 2\n', 'utf8');
  const inner = makeApplyPatchTool(dir);
  const guarded = linterGuardedEdit(inner, dir, regexLinter([/^FORBIDDEN/]));
  const result = guarded.run({
    patch: '*** Begin Patch\n*** Update File: hello.py\n@@ line 1\n+FORBIDDEN line\n*** End Patch',
  });
  assert.equal(result.ok, false);
  assert.equal(result.rolledBack, true);
  assert.match(result.error ?? '', /lint-guard/);
  const after = readFileSync(join(dir, 'hello.py'), 'utf8');
  assert.equal(after, 'x = 1\ny = 2\n');
  rmSync(dir, { recursive: true, force: true });
});

test('P0-1: linterGuardedEdit passes clean edits through unchanged', async () => {
  const dir = tempDir();
  writeFileSync(join(dir, 'hello.py'), 'x = 1\n', 'utf8');
  const inner = makeApplyPatchTool(dir);
  const guarded = linterGuardedEdit(inner, dir, noopLinter);
  const result = guarded.run({
    patch: '*** Begin Patch\n*** Update File: hello.py\n@@ line 1\nx = 42\n*** End Patch',
  });
  assert.equal(result.ok, true);
  rmSync(dir, { recursive: true, force: true });
});

// === P0-2 Testing Agent ===
test('P0-2: generateFail2PassTests accepts failure test that fails on HEAD', async () => {
  let calls = 0;
  const { accepted, rejected } = await generateFail2PassTests(
    { description: 'add 1+1' },
    {
      runOnHead: async () => { calls++; return calls === 1 ? 'fail' : 'pass'; },
      runOnFix: async () => 'pass',
    },
    {
      failure: () => 'assert 1+1 == 3',
      happy: (_, s) => `assert 1+1 == 2 (${s})`,
      edge: (_, s) => `assert isinstance(2, int) (${s})`,
    },
  );
  // First call returns 'fail' (failure test), subsequent return 'pass' (Pass2Pass)
  // Result: 3 accepted (failure passes HEAD=match expect, happy/edge also match HEAD=pass)
  assert.equal(accepted.length, 3);
  const failure = accepted.find((t) => t.kind === 'failure');
  assert.ok(failure);
  assert.equal(failure.headResult, 'fail');
  assert.equal(rejected.length, 0);
});

test('P0-2: generateFail2PassTests rejects failure test when HEAD passes it', async () => {
  const { accepted, rejected } = await generateFail2PassTests(
    { description: 'all pass' },
    { runOnHead: async () => 'pass', runOnFix: async () => 'pass' },
    {
      failure: () => 'assert False',
      happy: () => 'assert True',
      edge: () => 'assert 1 == 1',
    },
  );
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].kind, 'failure');
  assert.equal(accepted.length, 2);
});

// === P1-3 Episode Budget ===
test('P1-3: makeEpisodeBudget tracks spend and detects exhaustion', () => {
  const budget = makeEpisodeBudget({ maxBudgetUsd: 0.10, costPer1kInputTokens: 0.01, costPer1kOutputTokens: 0.03 });
  assert.equal(budget.isExhausted(), false);
  budget.record(1000, 1000);
  assert.equal(budget.state.spentUsd, 0.04);
  budget.record(2000, 1000);
  assert.ok(!budget.isExhausted());
  assert.equal(budget.wouldExceed(2000, 1000), true);
});

test('P1-3: default cap is 0.50 matching SWE-Agent', () => {
  const budget = makeEpisodeBudget({ costPer1kInputTokens: 0.01, costPer1kOutputTokens: 0.03 });
  assert.equal(budget.remaining(), 0.50);
});

// === P1-4 State Snapshot ===
test('P1-4: writeSnapshot + readSnapshot roundtrip', () => {
  const dir = tempDir();
  const globals = capturePrimitives({ x: 1, name: 'foo', items: [1, 2, 3], obj: { nested: true } });
  const { path, bytes } = writeSnapshot(dir, 'k1', globals, 5);
  assert.ok(bytes > 0);
  assert.ok(existsSync(path));
  const snap = readSnapshot(dir);
  assert.equal(snap.kernel_id, 'k1');
  assert.equal(snap.cell_count, 5);
  assert.equal(snap.globals.x.value, 1);
  assert.equal(snap.globals.items._repr, 'array');
  rmSync(dir, { recursive: true, force: true });
});

test('P1-4: readSnapshot returns null when no snapshot exists', () => {
  const dir = tempDir();
  assert.equal(readSnapshot(dir), null);
  rmSync(dir, { recursive: true, force: true });
});

// === P1-5 Observation Compressor ===
test('P1-5: compressObservations keeps tail verbatim when within window', () => {
  const r = compressObservations(['a', 'b', 'c'], { windowSize: 20 });
  assert.equal(r.dropped, 0);
  assert.equal(r.tail.length, 3);
  assert.equal(r.summary, '');
});

test('P1-5: compressObservations summarises older history when over window', () => {
  const obs = Array.from({ length: 100 }, (_, i) => `obs-${i}: something happened`);
  const r = compressObservations(obs, { windowSize: 20, summariseFraction: 0.8 });
  assert.equal(r.tail.length, 20);
  assert.equal(r.tail[0], 'obs-80: something happened');
  assert.ok(r.summary.length > 0);
  assert.ok(r.summary.includes('obs 1-'));
});

// === P1-6 JoyCode Voting ===
test('P1-6: scorePatch weights correctness most heavily', () => {
  const perfect = scorePatch({ id: 'a', testsPassed: 3, testsTotal: 3, diffSize: 10, touchesProtected: false, codeQuality: 1, testCoverage: 1 });
  const half = scorePatch({ id: 'b', testsPassed: 1, testsTotal: 3, diffSize: 10, touchesProtected: false, codeQuality: 1, testCoverage: 1 });
  assert.ok(perfect > half);
});

test('P1-6: scorePatch penalises protected-file touches via risk factor', () => {
  const safe = scorePatch({ id: 's', testsPassed: 3, testsTotal: 3, diffSize: 10, touchesProtected: false, codeQuality: 1, testCoverage: 1 });
  const risky = scorePatch({ id: 'r', testsPassed: 3, testsTotal: 3, diffSize: 10, touchesProtected: true, codeQuality: 1, testCoverage: 1 });
  assert.ok(safe > risky);
  assert.equal(risky, safe - JOYCODE_WEIGHTS.risk);
});

test('P1-6: voteBest picks highest-scoring candidate', () => {
  const cands = [
    { id: 'a', testsPassed: 1, testsTotal: 3, diffSize: 100, touchesProtected: true, codeQuality: 0.5, testCoverage: 0.5 },
    { id: 'b', testsPassed: 3, testsTotal: 3, diffSize: 10, touchesProtected: false, codeQuality: 1, testCoverage: 1 },
  ];
  assert.equal(voteBest(cands), 1);
  assert.equal(voteBest([]), -1);
});

// === P2-7 Feedback Event ===
test('P2-7: buildFeedbackEvent extracts summary from last traceback line', () => {
  const stderr = `Traceback (most recent call last):
  File "x.py", line 1
NameError: name 'x' is not defined`;
  const ev = buildFeedbackEvent('c1', false, stderr);
  assert.equal(ev.ok, false);
  assert.ok(ev.summary.includes('NameError'));
  assert.equal(isNameError(ev), true);
  assert.equal(isImportError(ev), false);
});

test('P2-7: buildFeedbackEvent detects ImportError', () => {
  const ev = buildFeedbackEvent('c2', false, 'ModuleNotFoundError: No module named foo');
  assert.equal(isImportError(ev), true);
});

// === P2-8 Fuzzy Patch ===
test('P2-8: fuzzyFind finds exact match with similarity 1', () => {
  const r = fuzzyFind('hello world\nfoo bar\nbaz qux', 'foo bar');
  assert.equal(r.index, 1);
  assert.equal(r.similarity, 1);
});

test('P2-8: fuzzyFind handles small typo', () => {
  const r = fuzzyFind('hello world\nfoo bxr\nbaz qux', 'foo bar', 0.7);
  assert.ok(r.index >= 0);
  assert.ok(r.similarity > 0.5);
});

test('P2-8: fuzzyFind returns -1 below threshold', () => {
  const r = fuzzyFind('hello world\nfoo baz\nqux quux', 'xyzzz', 0.9);
  assert.equal(r.index, -1);
});

test('P2-8: applyFuzzy rewrites body around fuzzy match', () => {
  const result = applyFuzzy('hello world\nfoo bxr\nbaz qux', 'foo bar', 'foo NEW');
  assert.equal(result, 'hello world\nfoo NEW\nbaz qux');
});

// === P2-9 Docker Isolation ===
test('P2-9: isDockerAvailable returns boolean without throwing', async () => {
  const r = await isDockerAvailable();
  assert.equal(typeof r, 'boolean');
});

test('P2-9: dockerRunPython returns structured failure when docker absent', async () => {
  const r = await dockerRunPython('print(1+1)', { timeoutMs: 3000 });
  assert.equal(typeof r.stdout, 'string');
  assert.equal(typeof r.stderr, 'string');
  assert.ok(r.exitCode !== 0 || r.stderr.length > 0);
});

// === P3-10 Mini Variant ===
test('P3-10: makeMiniVariant produces 3 tools by default', () => {
  const dir = tempDir();
  const tools = makeMiniVariant({ cwd: dir });
  assert.equal(tools.length, 3);
  assert.deepEqual(tools.map((t) => t.name), ['read_file', 'bash', 'submit']);
  rmSync(dir, { recursive: true, force: true });
});

test('P3-10: read_file returns not-found for missing file', async () => {
  const dir = tempDir();
  const tools = makeMiniVariant({ cwd: dir });
  const readTool = tools.find((t) => t.name === 'read_file');
  const r = await readTool.invoke({ path: 'missing.txt' });
  assert.equal(r.error, 'not-found');
  rmSync(dir, { recursive: true, force: true });
});

test('P3-10: bash enforces maxCmdLen', async () => {
  const dir = tempDir();
  const tools = makeMiniVariant({ cwd: dir, maxCmdLen: 8 });
  const bash = tools.find((t) => t.name === 'bash');
  const r = await bash.invoke({ cmd: 'echo this is way too long' });
  assert.equal(r.error, 'cmd-too-long');
  rmSync(dir, { recursive: true, force: true });
});

test('P3-10: makeMiniToolSet adds edit_file to the 3 base tools', () => {
  const dir = tempDir();
  const tools = makeMiniToolSet({ cwd: dir });
  assert.equal(tools.length, 4);
  assert.ok(tools.find((t) => t.name === 'edit_file'));
  rmSync(dir, { recursive: true, force: true });
});

test('P3-10: makeMiniEditFile writes file atomically', () => {
  const dir = tempDir();
  const tool = makeMiniEditFile(dir);
  const r = tool.invoke({ path: 'a.txt', content: 'hello mini' });
  assert.equal(r.ok, true);
  const after = readFileSync(join(dir, 'a.txt'), 'utf8');
  assert.equal(after, 'hello mini');
  rmSync(dir, { recursive: true, force: true });
});
