/**
 * types.ts
 *
 * Domain contracts for the SEAC runtime:
 * State, Evidence, Authority, Coordination.
 */

export type Timestamp = string;

export type ActorRole =
  | 'principal'
  | 'initializer'
  | 'coding'
  | 'verifier'
  | 'observer';

export interface ActorIdentity {
  id: string;
  role: ActorRole;
  trustDomain: string;
}

export interface Mission {
  id: string;
  goal: string;
  /** Intentions the agent cannot override or rewrite. */
  protectedIntentions: string[];
  /** Allowed capability scopes. */
  capabilityBoundary: string[];
  /** Whether high-impact effects need a human approval gate. */
  approvalThreshold: 'none' | 'high-impact';
}

export interface CapabilityGrant {
  id: string;
  actor: string;
  scope: string;
  level: 'read' | 'act' | 'oversee';
  issuedBy: string;
  issuedAt: Timestamp;
  revokedAt?: Timestamp;
}

export interface Feature {
  id: string;
  description: string;
  steps: string[];
  passes: boolean;
  evidenceEventId?: string;
}

export interface FeatureSpec {
  id: string;
  description: string;
  steps: string[];
}

export interface CheckResult {
  ok: boolean;
  /** Named gaps that the check identified but did not auto-repair. */
  gaps?: string[];
  detail?: string;
  /** Optional structured measurements (latency, count, ratio). */
  measurements?: Record<string, number | string | boolean>;
}

/**
 * A deterministic, model-independent requirement check (fresh-context verifier).
 * Each check is pinned to a semantic version so the harness can refuse verdicts
 * against a stale rubric.
 */
export interface FeatureCheck {
  id: string;
  requirement: string;
  /** Semantic version of the rubric; bumped on every meaningful change. */
  version: string;
  verify: () => CheckResult | Promise<CheckResult>;
}

export type EventType =
  | 'mission.created'
  | 'grant.issued'
  | 'grant.revoked'
  | 'approval.granted'
  | 'approval.denied'
  | 'claim.recorded'
  | 'plan.recorded'
  | 'candidate.proposed'
  | 'critique.recorded'
  | 'revision.requested'
  | 'evaluation.recorded'
  | 'evidence.attached'
  | 'effect.requested'
  | 'effect.actualized'
  | 'effect.verified'
  | 'effect.reverted'
  | 'checkpoint.created'
  | 'rollback.requested'
  | 'feature.registered'
  | 'feature.updated'
  | 'belief.asserted'
  | 'belief.retracted'
  | 'effect.intent'
  | 'simulation.recorded'
  | 'conjecture.recorded'
  | 'conjecture.resolved'
  | 'trust.assessed'
  | 'failure.attributed'
  | 'intervention.recorded'
  | 'entropy.audited'
  | 'identity.bound'
  | 'oversight.escalated'
  | 'check.recorded'
  | 'constitution.amended'
  | 'evolution.gate'
  | 'shutdown.requested';

export interface Event {
  id: string;
  seq: number;
  at: Timestamp;
  type: EventType;
  actor: string;
  payload: Record<string, unknown>;
  /** Causal parent event id. */
  parent?: string;
  /** Backing evidence event id, when the event is evidence-grounded. */
  evidence?: string;
  /** SHA-256 hash of the canonical form of the previous event (genesis = 64 zeros). */
  prevHash: string;
  /** SHA-256 hash of the canonical form of this event. */
  hash: string;
  /** Optional idempotency key mirrored into payload for visibility. */
  idempotencyKey?: string;
}

export interface Claim {
  id: string;
  actor: string;
  statement: string;
  evidenceIds: string[];
}

export interface Evidence {
  id: string;
  claimId?: string;
  source: string;
  kind: 'probe' | 'observation' | 'trace';
  ok: boolean;
  value: unknown;
}

export interface Effect {
  id: string;
  scope: string;
  featureId?: string;
  requested: string;
  actual?: string;
  status: 'requested' | 'actualized' | 'verified' | 'reverted';
}

export interface Projection {
  mission: Mission | null;
  grants: CapabilityGrant[];
  approvals: Set<string>;
  claims: Map<string, Claim>;
  plans: Map<string, Plan>;
  candidates: Map<string, Candidate>;
  critiques: Map<string, CritiqueRecord>;
  beliefs: Map<string, Belief>;
  evidence: Map<string, Evidence>;
  effects: Map<string, Effect>;
  features: Map<string, Feature>;
  checkpoints: Event[];
  shutdown: boolean;
}

/** The "brain": pluggable reasoning. A real deployment swaps this for an LLM. */
export interface Plan {
  id: string;
  featureId: string;
  claim: string;
  steps: string[];
}

export interface Candidate {
  id: string;
  planId: string;
  content: string;
}

export interface Principle {
  id: string;
  statement: string;
}

export interface Critique {
  principleId: string;
  ok: boolean;
  reason: string;
}

export interface CritiqueRecord {
  id: string;
  candidateId: string;
  critiques: Critique[];
  ok: boolean;
}

export interface Evaluation {
  ok: boolean;
  summary: string;
}

export interface Reasoner {
  plan(mission: Mission, features: Feature[], context: string): Promise<Plan> | Plan;
  generate(plan: Plan, context: string): Promise<Candidate> | Candidate;
  critique(candidate: Candidate, principles: Principle[], context: string): Promise<Critique[]> | Critique[];
  evaluate(candidate: Candidate, evidence: Evidence[], context: string): Promise<Evaluation> | Evaluation;
}

export interface Belief {
  id: string;
  subject: string;
  value: unknown;
  retracted: boolean;
}

export interface Tool {
  name: string;
  scope: string;
  description: string;
  run: (input: Record<string, unknown>) => Promise<unknown> | unknown;
  snapshot: () => unknown;
  restore: (snapshot: unknown) => void;
}

export interface SandboxResult {
  ok: boolean;
  output?: unknown;
  error?: string;
}

export interface OversightMetrics {
  totalFeatures: number;
  passingFeatures: number;
  plans: number;
  candidates: number;
  critiques: number;
  revisions: number;
  claims: number;
  evidence: number;
  effects: number;
  verifiedEffects: number;
  revertedEffects: number;
  beliefs: number;
  retractedBeliefs: number;
  blindSpots: number;
  failureAttributions: number;
  interventions: number;
  avoidableInterventions: number;
  entropyScore: number;
  shutdown: boolean;
}

export interface TrustAssessment {
  ok: boolean;
  trust: 'trusted' | 'untrusted';
  reason: string;
}

export interface SimulatedOutcome {
  toolName: string;
  input: Record<string, unknown>;
  predicted: unknown;
  confidence: number;
}

export interface AuthorityDecision {
  ok: boolean;
  reason?: string;
  approvalRequired?: boolean;
}

export interface ProbeResult {
  ok: boolean;
  value: unknown;
  detail?: string;
}

export interface Probe {
  id: string;
  run: () => Promise<ProbeResult> | ProbeResult;
}

export interface EffectHandler {
  scope: string;
  probeId: string;
  applies: (feature: Feature) => boolean;
  describe: (feature: Feature) => string;
  run: (feature: Feature) => Promise<string> | string;
  revert: (feature: Feature) => Promise<void> | void;
  snapshot: () => unknown;
}

export interface RuntimeOptions {
  mission: Mission;
  features: FeatureSpec[];
  grants: CapabilityGrant[];
  probes: Probe[];
  effectHandlers: EffectHandler[];
  highImpactScopes: Set<string>;
  approve?: (scope: string, detail: string) => Promise<boolean> | boolean;
  storeDir?: string;
}

export interface RunResult {
  ok: boolean;
  reason?: string;
  featureId?: string;
  eventId?: string;
}
