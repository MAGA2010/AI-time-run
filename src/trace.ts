/**
 * trace.ts
 *
 * Renders a single self-contained HTML trace viewer from a ledger. The page
 * embeds the episode package and the full event log as data, then colors
 * every row by whether the invariant layer accepted or rejected it. It opens
 * offline from file:// with no server and no external assets.
 */

import { buildEpisode } from './episode.js';
import { validateLedger } from './invariants.js';
import type { Ledger } from './ledger.js';
import type { EpisodePackage } from './episode.js';

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function flagEventIds(ledger: Ledger, violations: string[]): Set<string> {
  const flagged = new Set<string>();
  for (const event of ledger.all()) {
    for (const violation of violations) {
      const parts = violation.split(':');
      const isFeaturePass =
        parts[0] === 'unverified-feature-pass' &&
        event.type === 'feature.updated' &&
        String(event.payload.featureId) === parts.slice(1).join(':');
      const isEventViolation = parts.includes(event.id);
      if (isFeaturePass || isEventViolation) flagged.add(event.id);
    }
  }
  return flagged;
}

function eventClass(event: { type: string }, flagged: Set<string>, id: string): string {
  if (flagged.has(id)) return 'row forged';
  if (event.type === 'effect.verified' || event.type === 'feature.updated') {
    return 'row verified';
  }
  if (event.type === 'effect.reverted' || event.type === 'rollback.requested') {
    return 'row rolledback';
  }
  return 'row';
}

function responsibilityTable(pkg: EpisodePackage): string {
  const labels: Record<string, string> = {
    taskSpecification: 'Task interface',
    contextSelection: 'Context manager',
    toolAccess: 'Tool registry',
    projectMemory: 'Project memory',
    taskState: 'Task state',
    observability: 'Observability',
    failureAttribution: 'Failure attribution',
    verification: 'Verification protocol',
    permissions: 'Permission boundary',
    entropyAudit: 'Entropy auditor',
    interventionRecording: 'Intervention logger',
  };
  const rows = Object.entries(pkg.responsibilityCoverage)
    .map(
      ([key, covered]) =>
        `<tr class="${covered ? 'ok' : 'miss'}"><td>${escapeHtml(labels[key] ?? key)}</td>` +
        `<td>${covered ? 'covered' : 'missing'}</td></tr>`,
    )
    .join('');
  return `<table class="grid"><thead><tr><th>Responsibility</th><th>Evidence</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function eventRows(ledger: Ledger, flagged: Set<string>): string {
  return ledger
    .all()
    .map((event) => {
      const cls = eventClass(event, flagged, event.id);
      const payload = escapeHtml(JSON.stringify(event.payload));
      const parent = event.parent ? `&larr; ${escapeHtml(event.parent.slice(0, 8))}` : '';
      const evidence = event.evidence ? `+ ${escapeHtml(event.evidence.slice(0, 8))}` : '';
      return (
        `<tr class="${cls}"><td class="seq">${event.seq}</td>` +
        `<td class="type">${escapeHtml(event.type)}</td>` +
        `<td class="actor">${escapeHtml(event.actor)}</td>` +
        `<td class="payload">${payload} ${parent} ${evidence}</td></tr>`
      );
    })
    .join('');
}

export interface TraceRenderOptions {
  title?: string;
}

export function renderTraceHtml(ledger: Ledger, options: TraceRenderOptions = {}): string {
  const validation = validateLedger(ledger);
  const episode = buildEpisode(ledger);
  const flagged = flagEventIds(ledger, validation.violations);
  const title = options.title ?? 'AI Time Run trace';

  const findings = episode.entropyAudit.findings
    .map(
      (finding) =>
        `<li class="${finding.severity}">${escapeHtml(finding.kind)} x${finding.count} — ${escapeHtml(finding.description)}</li>`,
    )
    .join('') || '<li class="clean">no entropy findings</li>';

  const attributions = episode.failureAttributions
    .map(
      (attribution) =>
        `<li><b>${escapeHtml(attribution.failureType)}</b> ${escapeHtml(attribution.featureId)} — ${escapeHtml(attribution.diagnosis)}</li>`,
    )
    .join('') || '<li>none</li>';

  const interventions = episode.interventions
    .map(
      (intervention) =>
        `<li>${escapeHtml(intervention.kind)} ${escapeHtml(intervention.subject)} ` +
        `(${intervention.avoidable ? 'avoidable' : 'unavoidable'}) — ${escapeHtml(intervention.detail)}</li>`,
    )
    .join('') || '<li>none</li>';

  const reports = episode.verificationReports
    .map(
      (report) =>
        `<li>${escapeHtml(report.featureId)}: ${report.passed ? 'pass' : 'fail'} ` +
        `(${escapeHtml(report.trust)})${report.probeId ? ' via ' + escapeHtml(report.probeId) : ''}</li>`,
    )
    .join('') || '<li>none</li>';

  const checks = episode.deterministicChecks
    .map(
      (check) =>
        `<li class="${check.passed ? 'ok' : 'bad'}">${escapeHtml(check.requirement)}</li>`,
    )
    .join('') || '<li>none</li>';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: #f6f7f9; color: #1f2937; }
  header { padding: 20px 24px; border-bottom: 1px solid #e5e7eb; background: #fff; }
  h1 { font-size: 18px; margin: 0 0 4px; letter-spacing: 0; }
  .sub { color: #6b7280; font-size: 12px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 6px; background: #111827; color: #fff; font-size: 12px; margin-left: 8px; }
  main { padding: 20px 24px; max-width: 1180px; }
  section { margin: 0 0 24px; }
  h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 0; color: #374151; border-bottom: 1px solid #e5e7eb; padding-bottom: 6px; }
  ul { margin: 8px 0 0; padding-left: 18px; }
  .grid { width: 100%; border-collapse: collapse; background: #fff; font-size: 12px; }
  .grid th, .grid td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
  .grid th { background: #f9fafb; position: sticky; top: 0; }
  .row td { color: #374151; }
  .row.verified td { background: #f0fdf4; }
  .row.rolledback td { background: #fff7ed; }
  .row.forged td { background: #fef2f2; color: #991b1b; }
  .seq { width: 48px; color: #9ca3af; }
  .type { width: 180px; }
  .actor { width: 110px; color: #6b7280; }
  .payload { word-break: break-all; }
  .ok { color: #15803d; }
  .bad, .high { color: #b91c1c; }
  .medium { color: #b45309; }
  .low { color: #a16207; }
  .clean { color: #15803d; }
</style>
</head>
<body>
<header>
  <h1>${escapeHtml(title)} <span class="badge">${escapeHtml(episode.harnessLevel)}</span></h1>
  <div class="sub">
    ${escapeHtml(ledger.length)} events ·
    ${validation.ok ? 'VALID' : 'VIOLATIONS: ' + escapeHtml(validation.violations.length)} ·
    entropy ${escapeHtml(episode.entropyAudit.score)} ·
    episode ${escapeHtml(episode.id)}
  </div>
</header>
<main>
  <section>
    <h2>Episode Package</h2>
    <ul>
      <li><b>Harness level:</b> ${escapeHtml(episode.harnessLevel)}</li>
      <li><b>Features:</b> ${escapeHtml(episode.reproductionLog.featureIds.join(', ') || 'none')}</li>
      <li><b>Tools:</b> ${escapeHtml(episode.reproductionLog.tools.join(', ') || 'none')}</li>
    </ul>
    <h3>Deterministic checks</h3><ul>${checks}</ul>
    <h3>Verification reports</h3><ul>${reports}</ul>
    <h3>Failure attribution</h3><ul>${attributions}</ul>
    <h3>Interventions</h3><ul>${interventions}</ul>
    <h3>Entropy audit</h3><ul>${findings}</ul>
  </section>
  <section>
    <h2>Eleven Harness Responsibilities</h2>
    ${responsibilityTable(episode)}
  </section>
  <section>
    <h2>Event Ledger</h2>
    <table class="grid">
      <thead><tr><th>seq</th><th>type</th><th>actor</th><th>payload / links</th></tr></thead>
      <tbody>${eventRows(ledger, flagged)}</tbody>
    </table>
  </section>
</main>
</body>
</html>`;
}

