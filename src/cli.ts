#!/usr/bin/env node
import { runDemo } from './demo.js';
import { runCodeAgentDemo, type CodeAgentVariant } from './code/demo.js';
import { buildEpisode } from './episode.js';
import { validateLedger } from './invariants.js';
import { Ledger } from './ledger.js';
import { renderTraceHtml } from './trace.js';
import { ROLES } from './actors.js';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const command = args[0] ?? 'help';
const storeIndex = args.indexOf('--store');
const storeDir = storeIndex >= 0 && args[storeIndex + 1] ? args[storeIndex + 1] : undefined;

if (command === 'help' || command === undefined) {
  console.log('ai-time-run: evidence-verified event-sourced agent runtime');
  console.log('usage:');
  console.log('  ai-time-run demo   [--store <dir>]   run the managed-agent demo');
  console.log('  ai-time-run episode [--store <dir>]   print the Episode audit package');
  console.log('  ai-time-run trace  --store <dir>      render dir/trace.html from dir/ledger.jsonl');
  console.log('  ai-time-run tamper --store <dir>      write forged-ledger.jsonl + forged-trace.html');
  console.log('  ai-time-run codeagent [--variant codeact|self-debug|qa-review] [--store <dir>]');
  console.log('                                       run a BREAK 7 CodeAgent scenario');
  process.exit(command === 'help' ? 0 : 1);
}

if (command === 'episode') {
  if (!storeDir) {
    console.warn('warning: episode without --store runs in memory; pass --store <dir> when audit matters');
    const { runtime } = await runDemo(storeDir);
    const episode = buildEpisode(runtime.ledger);
    console.log(JSON.stringify(episode, null, 2));
    process.exit(0);
  }
  const ledger = Ledger.load(join(storeDir, 'ledger.jsonl'));
  const episode = buildEpisode(ledger);
  console.log(JSON.stringify(episode, null, 2));
  process.exit(0);
}

if (command === 'trace') {
  if (!storeDir) {
    console.error('trace requires --store <dir>');
    process.exit(1);
  }
  const ledger = Ledger.load(join(storeDir, 'ledger.jsonl'));
  const html = renderTraceHtml(ledger, { title: 'AI Time Run — clean trace' });
  const target = join(storeDir, 'trace.html');
  writeFileSync(target, html, 'utf8');
  console.log(`trace written to: ${target}`);
  process.exit(0);
}

if (command === 'tamper') {
  if (!storeDir) {
    console.error('tamper requires --store <dir>');
    process.exit(1);
  }
  const source = join(storeDir, 'ledger.jsonl');
  const ledger = Ledger.load(source);
  ledger.append({
    type: 'feature.updated',
    actor: ROLES.evaluator,
    payload: { featureId: 'ghost-feature', passes: true },
  });
  ledger.append({
    type: 'effect.requested',
    actor: ROLES.generator,
    payload: { scope: 'http' },
  });
  ledger.append({
    type: 'effect.verified',
    actor: ROLES.evaluator,
    payload: { scope: 'ui', featureId: 'ghost-feature' },
  });
  const forgedLedger = join(storeDir, 'forged-ledger.jsonl');
  ledger.save(forgedLedger);
  const validation = validateLedger(ledger);
  const html = renderTraceHtml(ledger, { title: 'AI Time Run — forged trace' });
  const target = join(storeDir, 'forged-trace.html');
  writeFileSync(target, html, 'utf8');
  console.log(`forged ledger written to: ${forgedLedger}`);
  console.log(`forged trace written to: ${target}`);
  console.log(
    `forged validation: ${validation.ok ? 'UNEXPECTED OK' : 'VIOLATIONS: ' + validation.violations.join(', ')}`,
  );
  process.exit(1);
}

if (command === 'codeagent') {
  const variantIndex = args.indexOf('--variant');
  const variant = (variantIndex >= 0 ? args[variantIndex + 1] : 'codeact') as CodeAgentVariant;
  if (!['codeact', 'self-debug', 'qa-review'].includes(variant)) {
    console.error('unknown variant: ' + variant);
    process.exit(1);
  }
  const { runtime, cellsExecuted } = await runCodeAgentDemo({ variant, storeDir });
  const metrics = runtime.oversight.metrics();
  const validation = runtime.validate();
  const episode = runtime.episode();
  console.log('\n== CodeAgent demo (' + variant + ') ==');
  console.log('cells executed through interpreter: ' + cellsExecuted);
  console.log('features ' + metrics.passingFeatures + '/' + metrics.totalFeatures + ' passing');
  console.log('\n== Ledger integrity ==');
  console.log(
    runtime.ledger.length + ' events, ' + (validation.ok ? 'VALID' : 'VIOLATIONS: ' + validation.violations.join(', ')),
  );
  console.log('\n== Episode package ==');
  console.log('harness level: ' + episode.harnessLevel);
  process.exit(0);
}

if (command !== 'demo') {
  console.error(`unknown command: ${command}`);
  process.exit(1);
}

const { runtime, results, validation, saved } = await runDemo(storeDir);
const metrics = runtime.oversight.metrics();
const episode = runtime.episode();

console.log('\n== Mission ==');
const mission = runtime.mission();
console.log(`goal: ${mission.goal}`);
console.log(`boundary: ${mission.capabilityBoundary.join(', ')}`);

console.log('\n== Feature run ==');
for (const result of results) {
  console.log(
    `${result.ok ? 'PASS' : 'FAIL'}  ${result.featureId ?? '-'}  ${result.reason ? `(${result.reason})` : ''}`,
  );
}

console.log('\n== Oversight metrics ==');
console.log(
  `features ${metrics.passingFeatures}/${metrics.totalFeatures} passing, ` +
    `plans ${metrics.plans}, candidates ${metrics.candidates}, ` +
    `critiques ${metrics.critiques}, revisions ${metrics.revisions}, ` +
    `claims ${metrics.claims}, evidence ${metrics.evidence}, ` +
    `effects ${metrics.effects} (${metrics.verifiedEffects} verified, ${metrics.revertedEffects} reverted), ` +
    `beliefs ${metrics.beliefs} (${metrics.retractedBeliefs} retracted), ` +
    `attributions ${metrics.failureAttributions}, interventions ${metrics.interventions} ` +
    `(${metrics.avoidableInterventions} avoidable), entropy ${metrics.entropyScore}`,
);

console.log('\n== Ledger integrity ==');
console.log(
  `${runtime.ledger.length} events, ${validation.ok ? 'VALID' : 'VIOLATIONS: ' + validation.violations.join(', ')}`,
);

const blindSpots = runtime.oversight.blindSpots();
console.log('\n== Blind spots ==');
console.log(blindSpots.length > 0 ? blindSpots.join('\n') : 'none');

console.log('\n== Progress journal ==');
for (const entry of runtime.progress.entries()) console.log(entry);

console.log('\n== Live beliefs ==');
for (const belief of runtime.beliefs.live()) {
  console.log(`${belief.subject}: ${JSON.stringify(belief.value)}`);
}

console.log(`\nledger saved to: ${saved ?? '(memory only)'}`);
console.log(`\n== Episode package ==`);
console.log(`harness level: ${episode.harnessLevel}`);
console.log(
  `responsibilities: ${Object.entries(episode.responsibilityCoverage)
    .filter(([, covered]) => covered)
    .length}/${Object.keys(episode.responsibilityCoverage).length} covered`,
);
