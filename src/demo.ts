/**
 * demo.ts
 *
 * A self-contained scenario that exercises the full managed-agent loop:
 * Planner -> Generator -> Critic (constitutional revision) -> Authority ->
 * Sandbox (hands) -> Evaluator (probe) -> Belief + Oversight.
 */

import { randomUUID } from 'node:crypto';

import { ManagedRuntime } from './orchestrator.js';
import type { FeatureBinding } from './orchestrator.js';
import { ROLES } from './actors.js';
import type {
  FeatureSpec,
  Probe,
  Reasoner,
  Tool,
} from './types.js';

const FORBIDDEN = 'UNSAFE';

interface World {
  scaffolded: boolean;
  persisted: boolean;
  synced: boolean;
  exported: boolean;
}

function makeReasoner(): Reasoner {
  return {
    plan: (_mission, features) => {
      const feature = features[0];
      return {
        id: randomUUID(),
        featureId: feature.id,
        claim: `Implement ${feature.id}: ${feature.description}`,
        steps: feature.steps,
      };
    },
    generate: (plan, context) => ({
      id: randomUUID(),
      planId: plan.id,
      content: context.includes('critique')
        ? `compliant implementation of ${plan.featureId}`
        : `${FORBIDDEN} implementation of ${plan.featureId}`,
    }),
    critique: (candidate, principles) =>
      principles.map((principle) => {
        const ok = !candidate.content.includes(FORBIDDEN);
        return {
          principleId: principle.id,
          ok,
          reason: ok ? 'compliant' : `contains ${FORBIDDEN}`,
        };
      }),
    evaluate: (_candidate, evidence) => ({
      ok: evidence.length > 0 && evidence.every((item) => item.ok),
      summary: evidence.length > 0 ? 'evidence-backed' : 'missing evidence',
    }),
  };
}

export function buildDemoOptions(storeDir?: string) {
  const world: World = { scaffolded: false, persisted: false, synced: false, exported: false };

  const features: FeatureSpec[] = [
    {
      id: 'scaffold',
      description: 'Scaffold the app shell',
      steps: ['generate shell', 'verify shell renders'],
    },
    {
      id: 'persist',
      description: 'Persist data to disk',
      steps: ['write data', 'verify it survives reload'],
    },
    {
      id: 'sync',
      description: 'Sync data over the network',
      steps: ['push data', 'verify remote matches'],
    },
    {
      id: 'export',
      description: 'Export a report',
      steps: ['generate report', 'verify file exists'],
    },
  ];

  const probes: Probe[] = [
    { id: 'ui-probe', run: () => ({ ok: world.scaffolded, value: world.scaffolded }) },
    { id: 'fs-probe', run: () => ({ ok: world.persisted, value: world.persisted }) },
    { id: 'http-probe', run: () => ({ ok: world.synced, value: world.synced }) },
    { id: 'report-probe', run: () => ({ ok: world.exported, value: world.exported }) },
  ];

  const tools: Tool[] = [
    {
      name: 'ui',
      scope: 'ui',
      description: 'scaffold the app shell',
      run: () => {
        world.scaffolded = true;
        return 'shell scaffolded';
      },
      snapshot: () => ({ scaffolded: world.scaffolded }),
      restore: (snapshot) => {
        world.scaffolded = Boolean((snapshot as { scaffolded?: boolean }).scaffolded);
      },
    },
    {
      name: 'fs',
      scope: 'fs',
      description: 'persist data to disk',
      run: () => {
        world.persisted = true;
        return 'data persisted';
      },
      snapshot: () => ({ persisted: world.persisted }),
      restore: (snapshot) => {
        world.persisted = Boolean((snapshot as { persisted?: boolean }).persisted);
      },
    },
    {
      name: 'http',
      scope: 'http',
      description: 'sync data over network',
      run: () => {
        world.synced = true;
        return 'data synced';
      },
      snapshot: () => ({ synced: world.synced }),
      restore: (snapshot) => {
        world.synced = Boolean((snapshot as { synced?: boolean }).synced);
      },
    },
    {
      name: 'report',
      scope: 'report',
      description: 'export a report',
      run: () => {
        world.exported = true;
        return 'report exported';
      },
      snapshot: () => ({ exported: world.exported }),
      restore: (snapshot) => {
        world.exported = Boolean((snapshot as { exported?: boolean }).exported);
      },
    },
  ];

  const bindings: FeatureBinding[] = [
    { featureId: 'scaffold', toolName: 'ui', probeId: 'ui-probe', scope: 'ui' },
    { featureId: 'persist', toolName: 'fs', probeId: 'fs-probe', scope: 'fs' },
    { featureId: 'sync', toolName: 'http', probeId: 'http-probe', scope: 'http' },
    { featureId: 'export', toolName: 'report', probeId: 'report-probe', scope: 'report' },
  ];

  const options = {
    mission: {
      id: 'managed-todo-app',
      goal: 'Build a managed todo app with brain/hands decoupling.',
      protectedIntentions: ['Do not rewrite the principal intent.'],
      capabilityBoundary: ['ui', 'fs', 'http', 'report'],
      approvalThreshold: 'high-impact' as const,
    },
    features,
    grants: [
      { id: 'g-ui', actor: ROLES.generator, scope: 'ui', level: 'act' as const, issuedBy: ROLES.principal, issuedAt: '' },
      { id: 'g-fs', actor: ROLES.generator, scope: 'fs', level: 'act' as const, issuedBy: ROLES.principal, issuedAt: '' },
      { id: 'g-report', actor: ROLES.generator, scope: 'report', level: 'act' as const, issuedBy: ROLES.principal, issuedAt: '' },
    ],
    principles: [
      { id: 'safe', statement: `must not contain ${FORBIDDEN}` },
      { id: 'scoped', statement: 'must stay within the mission boundary' },
    ],
    reasoner: makeReasoner(),
    bindings,
    tools,
    probes,
    highImpactScopes: new Set(['fs', 'http', 'report']),
    approve: async (scope: string) => scope === 'fs',
    storeDir,
  };

  return { options, world };
}

export async function runDemo(storeDir?: string) {
  const { options } = buildDemoOptions(storeDir);
  const runtime = ManagedRuntime.create(options);
  const results = await runtime.runAll();
  const validation = runtime.validate();
  const saved = runtime.save();

  return { runtime, results, validation, saved };
}
