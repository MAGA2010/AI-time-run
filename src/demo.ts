/**
 * demo.ts
 *
 * A self-contained scenario that exercises the whole loop: authorized
 * success, an approval gate, an unauthorized effect, and a missing handler.
 */

import { Runtime } from './runtime.js';
import type {
  EffectHandler,
  Feature,
  FeatureSpec,
  Probe,
  RuntimeOptions,
} from './types.js';

interface World {
  welcome: boolean;
  todosPersisted: boolean;
  synced: boolean;
  reportExported: boolean;
}

export function buildDemoOptions(storeDir?: string): {
  options: RuntimeOptions;
  world: World;
} {
  const world: World = {
    welcome: false,
    todosPersisted: false,
    synced: false,
    reportExported: false,
  };

  const features: FeatureSpec[] = [
    {
      id: 'render-welcome',
      description: 'Render the welcome screen',
      steps: ['open app', 'verify welcome message is visible'],
    },
    {
      id: 'persist-todos',
      description: 'Persist todos to disk',
      steps: ['add a todo', 'verify it survives reload'],
    },
    {
      id: 'sync-todos',
      description: 'Sync todos over the network',
      steps: ['enable sync', 'verify remote copy matches'],
    },
    {
      id: 'export-report',
      description: 'Export todos as a report',
      steps: ['choose export', 'verify report file is generated'],
    },
  ];

  const probes: Probe[] = [
    {
      id: 'ui-probe',
      run: () => ({ ok: world.welcome === true, value: world.welcome }),
    },
    {
      id: 'fs-probe',
      run: () => ({ ok: world.todosPersisted === true, value: world.todosPersisted }),
    },
    {
      id: 'http-probe',
      run: () => ({ ok: world.synced === true, value: world.synced }),
    },
    {
      id: 'report-probe',
      run: () => ({ ok: world.reportExported === true, value: world.reportExported }),
    },
  ];

  const uiHandler: EffectHandler = {
    scope: 'ui',
    probeId: 'ui-probe',
    applies: (feature: Feature) => feature.id === 'render-welcome',
    describe: () => 'set welcome state to true',
    run: () => {
      world.welcome = true;
      return 'welcome rendered';
    },
    revert: () => {
      world.welcome = false;
    },
    snapshot: () => ({ welcome: world.welcome, todosPersisted: world.todosPersisted }),
  };

  const fsHandler: EffectHandler = {
    scope: 'fs',
    probeId: 'fs-probe',
    applies: (feature: Feature) => feature.id === 'persist-todos',
    describe: () => 'persist todos to local store',
    run: () => {
      world.todosPersisted = true;
      return 'todos persisted';
    },
    revert: () => {
      world.todosPersisted = false;
    },
    snapshot: () => ({ welcome: world.welcome, todosPersisted: world.todosPersisted }),
  };

  const httpHandler: EffectHandler = {
    scope: 'http',
    probeId: 'http-probe',
    applies: (feature: Feature) => feature.id === 'sync-todos',
    describe: () => 'sync todos to remote server',
    run: () => {
      world.synced = true;
      return 'todos synced';
    },
    revert: () => {
      world.synced = false;
    },
    snapshot: () => ({ synced: world.synced }),
  };

  const reportHandler: EffectHandler = {
    scope: 'report',
    probeId: 'report-probe',
    applies: (feature: Feature) => feature.id === 'export-report',
    describe: () => 'generate report file',
    run: () => {
      world.reportExported = true;
      return 'report generated';
    },
    revert: () => {
      world.reportExported = false;
    },
    snapshot: () => ({ reportExported: world.reportExported }),
  };

  const options: RuntimeOptions = {
    mission: {
      id: 'todo-app',
      goal: 'Build a minimal todo app that renders, persists, and exports todos.',
      protectedIntentions: ['Do not rewrite the principal intent.'],
      capabilityBoundary: ['ui', 'fs', 'http'],
      approvalThreshold: 'high-impact',
    },
    features,
    grants: [
      { id: 'g-ui', actor: 'coding-agent', scope: 'ui', level: 'act', issuedBy: 'principal', issuedAt: '' },
      { id: 'g-fs', actor: 'coding-agent', scope: 'fs', level: 'act', issuedBy: 'principal', issuedAt: '' },
      { id: 'g-report', actor: 'coding-agent', scope: 'report', level: 'act', issuedBy: 'principal', issuedAt: '' },
    ],
    probes,
    effectHandlers: [uiHandler, fsHandler, httpHandler, reportHandler],
    highImpactScopes: new Set(['fs', 'http', 'report']),
    approve: async (scope: string) => scope === 'fs',
    storeDir,
  };

  return { options, world };
}

export async function runDemo(storeDir?: string) {
  const { options } = buildDemoOptions(storeDir);
  const runtime = Runtime.create(options);
  const results = await runtime.runAll();
  const validation = runtime.validate();
  const saved = runtime.save();

  return { runtime, results, validation, saved };
}
