/**
 * episode.ts
 *
 * The trace-based auditable Episode package (arXiv:2605.13357). A single
 * ledger run is distilled into a structured, offline-replayable artifact:
 * reproduction log, failure attribution, deterministic checks, verification
 * report, entropy audit, and intervention log. The package also classifies
 * the run against the H0-H3 harness ladder by inspecting what evidence the
 * ledger actually contains, not what the README claims.
 */

import { randomUUID } from 'node:crypto';

import { validateLedger } from './invariants.js';
import type { Ledger } from './ledger.js';
import { Oversight } from './oversight.js';
import { project } from './project.js';
import type { Event, EventType } from './types.js';

export type HarnessLevel = 'H0' | 'H1' | 'H2' | 'H3';

export type FailureType =
  | 'context'
  | 'tool'
  | 'feedback'
  | 'verify'
  | 'recovery'
  | 'entropy'
  | 'model'
  | 'unknown';

export type InterventionKind =
  | 'approval'
  | 'context'
  | 'feedback'
  | 'verification'
  | 'cleanup'
  | 'other';

export interface FailureAttribution {
  id: string;
  featureId: string;
  failureType: FailureType;
  diagnosis: string;
  attributedAt: string;
}

export interface InterventionRecord {
  id: string;
  kind: InterventionKind;
  subject: string;
  detail: string;
  /** true when the intervention substitutes for a missing harness responsibility. */
  avoidable: boolean;
  at: string;
}

export interface EntropyFinding {
  kind: string;
  severity: 'low' | 'medium' | 'high';
  description: string;
  count: number;
}

export interface EntropyAudit {
  at: string;
  score: number;
  findings: EntropyFinding[];
}

export interface ReproductionLog {
  missionId: string | null;
  featureIds: string[];
  actions: string[];
  tools: string[];
  contextSelections: string[];
}

export interface DeterministicCheck {
  id: string;
  requirement: string;
  passed: boolean;
  evidenceEventId?: string;
}

export interface VerificationReport {
  featureId: string;
  passed: boolean;
  probeId?: string;
  evidenceEventId?: string;
  trust: 'trusted' | 'untrusted';
  summary: string;
}

export interface EpisodePackage {
  id: string;
  generatedAt: string;
  harnessLevel: HarnessLevel;
  reproductionLog: ReproductionLog;
  failureAttributions: FailureAttribution[];
  deterministicChecks: DeterministicCheck[];
  verificationReports: VerificationReport[];
  entropyAudit: EntropyAudit;
  interventions: InterventionRecord[];
  invariants: { ok: boolean; violations: string[] };
  responsibilityCoverage: Record<string, boolean>;
}

const ACTION_TYPES = new Set([
  'plan.recorded',
  'claim.recorded',
  'candidate.proposed',
  'critique.recorded',
  'revision.requested',
  'effect.requested',
  'effect.actualized',
  'effect.verified',
  'effect.reverted',
  'rollback.requested',
  'feature.updated',
]);

const RESPONSIBILITIES: Array<[string, EventType]> = [
  ['taskSpecification', 'mission.created'],
  ['contextSelection', 'plan.recorded'],
  ['toolAccess', 'effect.requested'],
  ['projectMemory', 'feature.registered'],
  ['taskState', 'checkpoint.created'],
  ['observability', 'evidence.attached'],
  ['failureAttribution', 'failure.attributed'],
  ['verification', 'effect.verified'],
  ['permissions', 'grant.issued'],
  ['entropyAudit', 'entropy.audited'],
  ['interventionRecording', 'intervention.recorded'],
];

export function attributeFailure(
  ledger: Ledger,
  actor: string,
  featureId: string,
  failureType: FailureType,
  diagnosis: string,
): Event {
  return ledger.append({
    type: 'failure.attributed',
    actor,
    payload: { featureId, failureType, diagnosis },
  });
}

export function recordIntervention(
  ledger: Ledger,
  actor: string,
  kind: InterventionKind,
  subject: string,
  detail: string,
  avoidable: boolean,
): Event {
  return ledger.append({
    type: 'intervention.recorded',
    actor,
    payload: { kind, subject, detail, avoidable },
  });
}

function computeEntropy(ledger: Ledger): EntropyAudit {
  const state = project(ledger);
  const findings: EntropyFinding[] = [];
  let score = 0;

  const reverted = [...state.effects.values()].filter(
    (effect) => effect.status === 'reverted',
  ).length;
  const revisions = ledger.byType('revision.requested').length;
  const unverifiedClaims = [...state.claims.values()].filter(
    (claim) => claim.evidenceIds.length === 0,
  ).length;
  const blindSpots = new Oversight(ledger).blindSpots();
  const violations = validateLedger(ledger).violations;

  if (reverted > 0) {
    findings.push({
      kind: 'reverted-effects',
      severity: reverted >= 3 ? 'high' : 'medium',
      description: 'side effects that required rollback',
      count: reverted,
    });
    score += reverted * 2;
  }

  if (revisions > 0) {
    findings.push({
      kind: 'constitutional-revision-churn',
      severity: 'low',
      description: 'revision requests before a candidate passed critique',
      count: revisions,
    });
    score += revisions;
  }

  if (unverifiedClaims > 0) {
    findings.push({
      kind: 'unverified-claims',
      severity: 'medium',
      description: 'claims without backing evidence',
      count: unverifiedClaims,
    });
    score += unverifiedClaims;
  }

  if (blindSpots.length > 0) {
    findings.push({
      kind: 'pass-blind-spots',
      severity: 'high',
      description: 'passing features with missing evidence, plan, or critique',
      count: blindSpots.length,
    });
    score += blindSpots.length * 3;
  }

  if (violations.length > 0) {
    findings.push({
      kind: 'ledger-violations',
      severity: 'high',
      description: 'append-order, authority, or verification invariant violations',
      count: violations.length,
    });
    score += violations.length * 5;
  }

  return { at: new Date().toISOString(), score, findings };
}

export function auditEntropy(ledger: Ledger, actor: string): Event {
  const audit = computeEntropy(ledger);
  return ledger.append({
    type: 'entropy.audited',
    actor,
    payload: { score: audit.score, findings: audit.findings },
  });
}

function readEntropy(ledger: Ledger): EntropyAudit {
  const event = ledger.byType('entropy.audited').at(-1);
  if (event) {
    return {
      at: event.at,
      score: Number(event.payload.score ?? 0),
      findings: (event.payload.findings as EntropyFinding[]) ?? [],
    };
  }
  return computeEntropy(ledger);
}

function reproductionLog(ledger: Ledger): ReproductionLog {
  const state = project(ledger);
  const missionId = state.mission?.id ?? null;
  const featureIds = [...state.features.keys()];

  const actions: string[] = [];
  const tools = new Set<string>();
  const contextSelections: string[] = [];

  for (const event of ledger.all()) {
    if (ACTION_TYPES.has(event.type)) {
      actions.push(`${event.seq}:${event.type}:${String(event.payload.featureId ?? event.payload.scope ?? '')}`);
    }
    if (event.type === 'effect.requested') {
      tools.add(String(event.payload.scope));
    }
    if (event.type === 'claim.recorded' || event.type === 'plan.recorded') {
      contextSelections.push(String(event.payload.statement ?? event.payload.claim ?? ''));
    }
  }

  return { missionId, featureIds, actions, tools: [...tools], contextSelections };
}

function failureAttributions(ledger: Ledger): FailureAttribution[] {
  return ledger.byType('failure.attributed').map((event) => ({
    id: event.id,
    featureId: String(event.payload.featureId ?? ''),
    failureType: (event.payload.failureType as FailureType) ?? 'unknown',
    diagnosis: String(event.payload.diagnosis ?? ''),
    attributedAt: event.at,
  }));
}

function interventions(ledger: Ledger): InterventionRecord[] {
  return ledger.byType('intervention.recorded').map((event) => ({
    id: event.id,
    kind: (event.payload.kind as InterventionKind) ?? 'other',
    subject: String(event.payload.subject ?? ''),
    detail: String(event.payload.detail ?? ''),
    avoidable: Boolean(event.payload.avoidable),
    at: event.at,
  }));
}

function deterministicChecks(ledger: Ledger): DeterministicCheck[] {
  const checks: DeterministicCheck[] = [];
  for (const event of ledger.byType('feature.updated')) {
    checks.push({
      id: event.id,
      requirement: `feature ${String(event.payload.featureId)} passes`,
      passed: Boolean(event.payload.passes),
      evidenceEventId: event.payload.evidenceEventId as string | undefined,
    });
  }
  for (const violation of validateLedger(ledger).violations) {
    checks.push({
      id: `invariant:${violation}`,
      requirement: violation,
      passed: false,
    });
  }
  return checks;
}

function verificationReports(ledger: Ledger): VerificationReport[] {
  const state = project(ledger);
  const reports: VerificationReport[] = [];

  for (const feature of state.features.values()) {
    const evidence = feature.evidenceEventId
      ? state.evidence.get(feature.evidenceEventId)
      : undefined;
    reports.push({
      featureId: feature.id,
      passed: feature.passes,
      probeId: evidence?.source,
      evidenceEventId: feature.evidenceEventId,
      trust:
        evidence && evidence.ok && evidence.kind !== 'trace'
          ? 'trusted'
          : 'untrusted',
      summary: feature.passes ? 'evidence-backed' : 'not verified',
    });
  }

  return reports;
}

function responsibilityCoverage(ledger: Ledger): Record<string, boolean> {
  const coverage: Record<string, boolean> = {};
  for (const [name, type] of RESPONSIBILITIES) {
    coverage[name] = ledger.byType(type).length > 0;
  }
  return coverage;
}

function deriveHarnessLevel(
  attributions: FailureAttribution[],
  checks: DeterministicCheck[],
  reports: VerificationReport[],
  hasEntropyAudit: boolean,
  reproductions: ReproductionLog,
): HarnessLevel {
  const hasEvidence = reports.some((report) => report.evidenceEventId);
  const hasVerification = reports.some((report) => report.passed);
  const hasAttribution = attributions.length > 0;
  const hasChecks = checks.length > 0;
  const hasActions = reproductions.actions.length > 0;

  if (hasEvidence && hasVerification && hasAttribution && hasChecks && hasEntropyAudit) {
    return 'H3';
  }
  if (hasEvidence && hasVerification) return 'H2';
  if (hasActions) return 'H1';
  return 'H0';
}

export function buildEpisode(ledger: Ledger): EpisodePackage {
  const reproductions = reproductionLog(ledger);
  const attributions = failureAttributions(ledger);
  const checks = deterministicChecks(ledger);
  const reports = verificationReports(ledger);
  const entropy = readEntropy(ledger);
  const hasEntropyAudit = ledger.byType('entropy.audited').length > 0;

  return {
    id: randomUUID(),
    generatedAt: new Date().toISOString(),
    harnessLevel: deriveHarnessLevel(
      attributions,
      checks,
      reports,
      hasEntropyAudit,
      reproductions,
    ),
    reproductionLog: reproductions,
    failureAttributions: attributions,
    deterministicChecks: checks,
    verificationReports: reports,
    entropyAudit: entropy,
    interventions: interventions(ledger),
    invariants: validateLedger(ledger),
    responsibilityCoverage: responsibilityCoverage(ledger),
  };
}
