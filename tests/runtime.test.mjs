import test from 'node:test';
import assert from 'node:assert/strict';

import {
  Ledger,
  Runtime,
  ManagedRuntime,
  Sandbox,
  Constitution,
  DefaultReasoner,
  ROLES,
  Oversight,
  BeliefRouter,
  replay,
  slice,
  validateLedger,
  recordClaim,
  isVerified,
  attachEvidence,
} from '../dist/index.js';

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

function makeManagedRuntime({ failCritiqueOnce = true, toolThrows = false } = {}) {
  const world = { done: false };
  const options = {
    mission: {
      id: 'm1',
      goal: 'managed goal',
      protectedIntentions: ['no rewrite'],
      capabilityBoundary: ['tool'],
      approvalThreshold: 'high-impact',
    },
    features: [{ id: 'f1', description: 'do f1', steps: ['s1'] }],
    grants: [{ actor: ROLES.generator, scope: 'tool', level: 'act', issuedBy: ROLES.principal, issuedAt: '' }],
    principles: [{ id: 'safe', statement: 'no UNSAFE' }],
    reasoner: {
      plan: (_mission, features) => ({
        id: 'p1',
        featureId: features[0].id,
        claim: `Implement ${features[0].id}`,
        steps: features[0].steps,
      }),
      generate: (plan, context) => ({
        id: context.includes('critique') ? 'c2' : 'c1',
        planId: plan.id,
        content: context.includes('critique') ? 'good' : 'UNSAFE',
      }),
      critique: (candidate, principles) =>
        principles.map((principle) => ({
          principleId: principle.id,
          ok: !candidate.content.includes('UNSAFE'),
          reason: candidate.content.includes('UNSAFE') ? 'bad' : 'good',
        })),
      evaluate: (_candidate, evidence) => ({
        ok: evidence.length > 0 && evidence.every((item) => item.ok),
        summary: 'evidence-backed',
      }),
    },
    bindings: [{ featureId: 'f1', toolName: 'tool', probeId: 'probe', scope: 'tool' }],
    tools: [
      {
        name: 'tool',
        scope: 'tool',
        description: 'do work',
        run: () => {
          if (toolThrows) throw new Error('boom');
          world.done = true;
          return 'done';
        },
        snapshot: () => ({ done: world.done }),
        restore: (snapshot) => {
          world.done = Boolean(snapshot.done);
        },
      },
    ],
    probes: [{ id: 'probe', run: () => ({ ok: world.done, value: world.done }) }],
    highImpactScopes: new Set(),
    approve: () => true,
  };
  const runtime = ManagedRuntime.create(options);
  return { runtime, world };
}

test('managed loop runs constitutional revision before effect', async () => {
  const { runtime, world } = makeManagedRuntime({ failCritiqueOnce: true });
  const result = await runtime.runFeature('f1');

  assert.equal(result.ok, true);
  assert.equal(world.done, true);
  assert.ok(runtime.oversight.metrics().revisions >= 1);
  assert.ok(runtime.oversight.metrics().candidates >= 2);
  assert.ok(runtime.oversight.metrics().critiques >= 2);
  assert.equal(runtime.validate().ok, true);
  assert.deepEqual(runtime.oversight.blindSpots(), []);
});

test('sandbox isolates a throwing tool and reverts the effect', async () => {
  const { runtime, world } = makeManagedRuntime({ toolThrows: true });
  const result = await runtime.runFeature('f1');

  assert.equal(result.ok, false);
  assert.match(result.reason, /tool-failed/);
  assert.equal(world.done, false);
  assert.equal(runtime.oversight.metrics().revertedEffects, 1);
  assert.equal(runtime.validate().ok, true);
});

test('sandbox catches faults without throwing', async () => {
  const sandbox = new Sandbox();
  sandbox.register({
    name: 'boom',
    scope: 'tool',
    description: 'throws',
    run: () => {
      throw new Error('exploded');
    },
    snapshot: () => ({}),
    restore: () => {},
  });

  const result = await sandbox.execute('boom', {});
  assert.equal(result.ok, false);
  assert.equal(result.error, 'exploded');
});

test('session replay and slice reconstruct and filter events', async () => {
  const { runtime } = makeManagedRuntime({});
  await runtime.runFeature('f1');

  const state = replay(runtime.ledger);
  assert.equal(state.features.get('f1').passes, true);

  const plans = slice(runtime.ledger, { types: ['plan.recorded'] });
  assert.ok(plans.length >= 1);
  assert.ok(plans.every((event) => event.type === 'plan.recorded'));
});

test('belief router retracts with a tombstone', () => {
  const ledger = new Ledger();
  const beliefs = new BeliefRouter(ledger);
  const asserted = beliefs.assert('agent', 'sky-color', 'blue');

  assert.equal(beliefs.live().length, 1);
  beliefs.retract('agent', asserted.id);
  assert.equal(beliefs.live().length, 0);
  assert.equal(replay(ledger).beliefs.get(asserted.id).retracted, true);
});

test('oversight reports a passing feature with no evidence as a blind spot', () => {
  const ledger = new Ledger();
  ledger.append({
    type: 'feature.registered',
    actor: ROLES.initializer,
    payload: { featureId: 'ghost', description: 'ghost', steps: [] },
  });
  ledger.append({
    type: 'feature.updated',
    actor: ROLES.evaluator,
    payload: { featureId: 'ghost', passes: true },
  });

  const blindSpots = new Oversight(ledger).blindSpots();
  assert.ok(blindSpots.some((spot) => spot.startsWith('pass-without-evidence')));
});
