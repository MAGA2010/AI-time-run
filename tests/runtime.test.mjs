import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

import {
  Ledger,
  Runtime,
  ManagedRuntime,
  Sandbox,
  Simulator,
  TrustGateway,
  CausalGraph,
  classifyEffect,
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
  buildEpisode,
  renderTraceHtml,
  attributeFailure,
  recordIntervention,
  auditEntropy,
  IdentityEngine,
  SelectiveWorkspace,
  FileSystemAdapter,
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

test('causal graph rebuilds ancestors, descendants, and is acyclic', () => {
  const ledger = new Ledger();
  const a = ledger.append({ type: 'plan.recorded', actor: 'planner', payload: {} });
  const b = ledger.append({ type: 'candidate.proposed', actor: 'generator', payload: {}, parent: a.id });
  const c = ledger.append({ type: 'effect.requested', actor: 'generator', payload: { scope: 'fs' }, parent: b.id });

  const graph = new CausalGraph(ledger);
  assert.equal(graph.isAcyclic(), true);
  assert.deepEqual(graph.ancestors(c.id).sort(), [a.id, b.id].sort());
  assert.deepEqual(graph.descendants(a.id).sort(), [b.id, c.id].sort());
  assert.equal(graph.depth(c.id), 2);
});

test('insulation classifies high-impact scopes as atomic', () => {
  const atomicScopes = new Set(['fs']);
  const atomic = { type: 'effect.requested', payload: { scope: 'fs' } };
  const parallel = { type: 'effect.requested', payload: { scope: 'ui' } };

  assert.equal(classifyEffect(atomic, atomicScopes), 'atomic');
  assert.equal(classifyEffect(parallel, atomicScopes), 'parallel');
});

test('simulator explores counterfactuals without side effects', async () => {
  const world = { done: false };
  const sandbox = new Sandbox();
  sandbox.register({
    name: 'tool',
    scope: 'tool',
    description: 'mutate',
    run: () => {
      world.done = true;
      return 'done';
    },
    snapshot: () => ({ done: world.done }),
    restore: (snapshot) => {
      world.done = Boolean(snapshot.done);
    },
  });

  const simulator = new Simulator(sandbox);
  const outcome = await simulator.simulate('tool', {});

  assert.equal(outcome.predicted, 'done');
  assert.equal(outcome.confidence, 1);
  assert.equal(world.done, false);
});

test('trust gateway rejects untrusted or failed evidence', () => {
  const gateway = new TrustGateway();

  assert.equal(
    gateway.canMutateTrust({ id: 'e1', source: 'probe', kind: 'probe', ok: true, value: 1 }),
    true,
  );
  assert.equal(
    gateway.canMutateTrust({ id: 'e2', source: 'tool', kind: 'trace', ok: true, value: 1 }),
    false,
  );
  assert.equal(
    gateway.canMutateTrust({ id: 'e3', source: 'probe', kind: 'probe', ok: false, value: 0 }),
    false,
  );
});

test('managed runtime simulate and conjecture are recorded', async () => {
  const { runtime, world } = makeManagedRuntime({});
  await runtime.simulate('tool', {});

  assert.equal(world.done, false);
  assert.ok(runtime.ledger.byType('simulation.recorded').length >= 1);

  runtime.conjecture('f1', 'hypothesis');
  assert.ok(runtime.ledger.byType('conjecture.recorded').length >= 1);
});

test('episode package reaches H3 with full responsibility coverage', async () => {
  const { runtime } = makeManagedRuntime({});
  await runtime.runFeature('f1');

  runtime.auditEntropy();
  attributeFailure(runtime.ledger, ROLES.evaluator, 'f1', 'verify', 'synthetic attribution');
  recordIntervention(runtime.ledger, ROLES.principal, 'approval', 'f1', 'test approval', false);

  const episode = buildEpisode(runtime.ledger);

  assert.equal(episode.harnessLevel, 'H3');
  assert.equal(episode.failureAttributions.length, 1);
  assert.equal(episode.interventions.length, 1);
  assert.equal(Object.values(episode.responsibilityCoverage).filter(Boolean).length, 11);
  assert.equal(episode.invariants.ok, true);
});

test('entropy audit, intervention, and attribution are first-class events', async () => {
  const { runtime } = makeManagedRuntime({});
  await runtime.runFeature('f1');

  runtime.auditEntropy();
  recordIntervention(runtime.ledger, ROLES.principal, 'cleanup', 'f1', 'removed residue', true);
  attributeFailure(runtime.ledger, ROLES.evaluator, 'f1', 'entropy', 'stale artifact');

  const metrics = runtime.oversight.metrics();
  assert.equal(metrics.interventions, 1);
  assert.equal(metrics.avoidableInterventions, 1);
  assert.equal(metrics.failureAttributions, 1);
  assert.equal(metrics.entropyScore, runtime.ledger.byType('entropy.audited').at(-1).payload.score);
});

test('trace viewer renders a self-contained page and flags forged events', () => {
  const ledger = new Ledger();
  ledger.append({
    type: 'feature.registered',
    actor: ROLES.initializer,
    payload: { featureId: 'f', description: 'd', steps: [] },
  });
  ledger.append({
    type: 'feature.updated',
    actor: ROLES.evaluator,
    payload: { featureId: 'f', passes: true },
  });

  const html = renderTraceHtml(ledger, { title: 'forged demo' });
  assert.match(html, /forged demo/);
  assert.match(html, /Event Ledger/);
  assert.match(html, /row forged/);
  assert.match(html, /VIOLATIONS/);
});

test('identity engine binds identities and gates trust domains', () => {
  const identity = new IdentityEngine();
  identity.bind('planner', 'planner', 'local');

  assert.equal(identity.verify('planner').role, 'planner');
  assert.equal(identity.verify('ghost'), null);
  assert.equal(identity.handshake('planner', 'local'), true);
  assert.equal(identity.handshake('planner', 'remote'), false);
});

test('selective workspace strips blacklist and prepends constraints', () => {
  const workspace = new SelectiveWorkspace({
    budget: 1000,
    hardConstraints: ['no unsafe'],
    blacklist: ['UNSAFE'],
    criticalEvidence: ['evidence-1'],
  });

  const out = workspace.select('body UNSAFE text', ['extra-evidence']);
  assert.ok(out.includes('CONSTRAINT: no unsafe'));
  assert.ok(out.includes('EVIDENCE: evidence-1'));
  assert.ok(out.includes('EVIDENCE: extra-evidence'));
  assert.ok(!out.includes('UNSAFE'));
});

test('selective workspace truncates to budget', () => {
  const workspace = new SelectiveWorkspace({
    budget: 10,
    hardConstraints: [],
    blacklist: [],
    criticalEvidence: [],
  });
  const out = workspace.select('abcdefghijklmnopqrstuvwxyz');
  assert.ok(out.includes('SelectiveWorkspace truncated'));
});

test('filesystem adapter enforces root and round-trips writes', () => {
  const dir = join(os.tmpdir(), `aitr-fs-${Date.now()}`);
  const fs = new FileSystemAdapter(dir);

  fs.write('a.txt', 'hello');
  assert.equal(fs.exists('a.txt'), true);
  assert.equal(fs.read('a.txt'), 'hello');
  assert.throws(() => fs.write('../escape.txt', 'x'), /path-escape/);
  fs.remove('a.txt');
  assert.equal(fs.exists('a.txt'), false);
  rmSync(dir, { recursive: true, force: true });
});

test('oversight escalates and revokes the offending capability', () => {
  const ledger = new Ledger();
  const grantIssued = ledger.append({
    type: 'grant.issued',
    actor: 'principal',
    payload: { actor: 'generator', scope: 'fs', level: 'act' },
  });
  ledger.append({
    type: 'effect.requested',
    actor: 'intruder',
    payload: { scope: 'fs' },
  });

  const oversight = new Oversight(ledger);
  const result = oversight.escalate();

  assert.equal(result.escalated, true);
  assert.ok(result.actions.includes('revoke:fs'));
  assert.equal(ledger.byType('oversight.escalated').length, 1);
  assert.equal(ledger.byType('grant.revoked').length, 1);
  assert.equal(ledger.byType('grant.revoked')[0].payload.grantId, grantIssued.id);
});
