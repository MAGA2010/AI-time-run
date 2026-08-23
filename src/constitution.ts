/**
 * constitution.ts
 *
 * A runtime alignment layer in the spirit of Constitutional AI. Principles
 * are data, and a critic reviews every candidate against them before the
 * candidate may become an effect.
 */

import type { Candidate, Critique, Principle, Reasoner } from './types.js';

export class Constitution {
  private principles: Principle[] = [];

  constructor(principles: Principle[] = []) {
    this.principles = principles;
  }

  add(principle: Principle): void {
    this.principles.push(principle);
  }

  get rules(): readonly Principle[] {
    return this.principles;
  }

  async review(
    reasoner: Reasoner,
    candidate: Candidate,
    context: string,
  ): Promise<{ critiques: Critique[]; ok: boolean }> {
    const critiques = await reasoner.critique(candidate, this.principles, context);
    const covered = new Set(critiques.map((critique) => critique.principleId));

    // A principle with no critique is treated as unaddressed, not passed.
    for (const principle of this.principles) {
      if (!covered.has(principle.id)) {
        critiques.push({
          principleId: principle.id,
          ok: false,
          reason: `no critique recorded for principle: ${principle.id}`,
        });
      }
    }

    const ok = critiques.every((critique) => critique.ok);
    return { critiques, ok };
  }
}
