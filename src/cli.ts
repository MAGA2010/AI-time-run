#!/usr/bin/env node
import { runDemo } from './demo.js';

const args = process.argv.slice(2);
const command = args[0] ?? 'help';
const storeIndex = args.indexOf('--store');
const storeDir = storeIndex >= 0 && args[storeIndex + 1] ? args[storeIndex + 1] : undefined;

if (command !== 'demo') {
  console.log('ai-time-run: evidence-verified event-sourced agent runtime');
  console.log('usage: ai-time-run demo [--store <dir>]');
  process.exit(command === 'help' ? 0 : 1);
}

const { runtime, results, validation, saved } = await runDemo(storeDir);
const metrics = runtime.metrics();

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
    `claims ${metrics.claims}, evidence ${metrics.evidence}, ` +
    `effects ${metrics.effects} (${metrics.verifiedEffects} verified, ${metrics.revertedEffects} reverted)`,
);

console.log('\n== Ledger integrity ==');
console.log(
  `${runtime.ledger.length} events, ${validation.ok ? 'VALID' : 'VIOLATIONS: ' + validation.violations.join(', ')}`,
);

console.log('\n== Progress journal ==');
for (const entry of runtime.progress.entries()) console.log(entry);

console.log(`\nledger saved to: ${saved ?? '(memory only)'}`);
