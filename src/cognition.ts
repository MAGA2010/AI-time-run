/**
 * cognition.ts
 *
 * MDIBUS 02: cognitive services. A counterfactual simulator explores "what
 * if" without side effects, an observer bridge normalizes observations into
 * evidence, and a conjecture scheduler turns information gaps into testable
 * hypotheses rather than silent failures.
 */

import type { Ledger } from './ledger.js';
import type { Sandbox } from './sandbox.js';
import type { SimulatedOutcome } from './types.js';

export class Simulator {
  constructor(private sandbox: Sandbox) {}

  async simulate(toolName: string, input: Record<string, unknown>): Promise<SimulatedOutcome> {
    const snapshot = this.sandbox.snapshot();
    const result = await this.sandbox.execute(toolName, input);
    this.sandbox.restore(snapshot);

    return {
      toolName,
      input,
      predicted: result.output,
      confidence: result.ok ? 1 : 0,
    };
  }
}

export class ObserverBridge {
  normalize(source: string, ok: boolean, value: unknown) {
    return { source, kind: 'probe' as const, ok, value };
  }
}

export class ConjectureScheduler {
  constructor(private ledger: Ledger) {}

  schedule(actor: string, subject: string, hypothesis: unknown) {
    return this.ledger.append({
      type: 'conjecture.recorded',
      actor,
      payload: { subject, hypothesis },
    });
  }

  resolve(actor: string, conjectureId: string, evidenceId: string) {
    return this.ledger.append({
      type: 'conjecture.resolved',
      actor,
      payload: { conjectureId, evidenceId },
      evidence: evidenceId,
    });
  }
}
