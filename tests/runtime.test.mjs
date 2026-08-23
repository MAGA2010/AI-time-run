import test from 'node:test';
import assert from 'node:assert/strict';

import { Ledger, Runtime, validateLedger, recordClaim, isVerified, attachEvidence } from '../dist/index.js';

function makeWorld() {
  return { done: false };
}

function makeRuntime({ grants = [{ actor: 'coding-agent', scope: 'tool', level: 'act' }], approve, probeOk = true, features } = {}) {
  const world = makeWorld();
  const options = {
    mission: {
      id: 'test-mission',
      goal: 'test goal',
      protectedIntentions: ['no rewrite'],
      capabilityBoundary: ['tool'],
      approvalThreshold: 'high-impact',
    },
    features: features ?? [
      { id: 'feature-a', description: 'do a', steps: ['step 1'] },
      { id: 'feature-b', description: 'do b', steps: ['step 1'] },
    ],
    grants: grants.map((g) => ({ id: g.id ?? `g-${g.scope}`, actor: g.actor, scope: g.scope, level: g.level, issuedBy: 'principal', issuedAt: '' })),
    probes: [{ id: 'probe', run: () => ({ ok: probeOk, value: world.done }) }],
    effectHandlers: [
      {
        scope: 'tool',
        probeId: 'probe',
        applies: () => true,
        describe: () => 'do work',
        run: () => {
          world.done = true;
          return 'done';
        },
        revert: () => {
          world.done = false;
        },
        snapshot: () => ({ done: world.done }),
      },
    ],
    highImpactScopes: new Set(['tool']),
    approve,
  };
  const runtime = Runtime.create(options);
  return { runtime, world };
}

test('bootstrap registers every feature as failing', () => {
  const { runtime } = makeRuntime();
  const metrics = runtime.metrics();
  assert.equal(metrics.totalFeatures, 2);
  assert.equal(metrics.passingFeatures, 0);
  assert.equal(validateLedger(runtime.ledger).ok, true);
});

test('a feature only passes with verified evidence', async () => {
  const { runtime } = makeRuntime({ approve: () => true });
  const result = await runtime.runFeature('feature-a');
  assert.equal(result.ok, true);
  assert.equal(runtime.metrics().passingFeatures, 1);

  const passEvent = runtime.ledger.byType('feature.updated')[0];
  assert.equal(passEvent.payload.passes, true);
  assert.ok(passEvent.payload.evidenceEventId);
  assert.equal(validateLedger(runtime.ledger).ok, true);
});

test('an unauthorized effect is blocked before execution', async () => {
  const { runtime } = makeRuntime({ grants: [] });
  const result = await runtime.runFeature('feature-a');
  assert.equal(result.ok, false);
  assert.match(result.reason, /no-capability-grant/);
  assert.equal(runtime.ledger.byType('effect.requested').length, 0);
});

test('an approval gate can deny a high-impact effect', async () => {
  const { runtime } = makeRuntime({ approve: () => false });
  const result = await runtime.runFeature('feature-a');
  assert.equal(result.ok, false);
  assert.match(result.reason, /approval-denied/);
  assert.equal(runtime.ledger.byType('effect.requested').length, 0);
});

test('failed verification rolls the effect back', async () => {
  const { runtime, world } = makeRuntime({ approve: () => true, probeOk: false });
  const result = await runtime.runFeature('feature-a');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'verification-failed-and-rolled-back');
  assert.equal(world.done, false);
  assert.equal(runtime.metrics().revertedEffects, 1);
  assert.equal(runtime.metrics().passingFeatures, 0);
  assert.equal(validateLedger(runtime.ledger).ok, true);
});

test('shutdown halts the loop', async () => {
  const { runtime } = makeRuntime({ approve: () => true });
  runtime.shutdown('test stop');
  const result = await runtime.runFeature('feature-a');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'shutdown');
});

test('a claim is not verified without evidence', () => {
  const ledger = new Ledger();
  const claim = recordClaim(ledger, 'coding-agent', 'I can solve this');
  assert.equal(isVerified(ledger, claim.id), false);
  attachEvidence(ledger, 'verifier', claim.id, 'probe', 'probe', true, { ok: true });
  assert.equal(isVerified(ledger, claim.id), true);
});

test('validator rejects forged passes and forged verifications', () => {
  const ledger = new Ledger();
  ledger.append({
    type: 'feature.updated',
    actor: 'verifier',
    payload: { featureId: 'ghost', passes: true },
  });
  ledger.append({
    type: 'effect.verified',
    actor: 'verifier',
    payload: { scope: 'tool' },
  });
  const result = validateLedger(ledger);
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => v.startsWith('unverified-feature-pass')));
  assert.ok(result.violations.some((v) => v.startsWith('unverified-effect')));
});
