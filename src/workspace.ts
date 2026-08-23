/**
 * workspace.ts
 *
 * MDIBUS 08: Selective Workspace. Instead of dumping the whole ledger into
 * the model's context, only hard constraints, critical evidence, and a
 * budget-limited body are exposed. Blacklisted content is stripped before
 * anything reaches the brain.
 */

export interface WorkspacePolicy {
  /** Maximum context length in characters. */
  budget: number;
  /** Constraints that must always be visible. */
  hardConstraints: string[];
  /** Substrings that must never enter the context. */
  blacklist: string[];
  /** Evidence that must always be visible. */
  criticalEvidence: string[];
}

export class SelectiveWorkspace {
  constructor(private policy: WorkspacePolicy) {}

  select(context: string, extraCritical: string[] = []): string {
    let body = context;
    for (const banned of this.policy.blacklist) {
      body = body.split(banned).join('');
    }

    const constraints = this.policy.hardConstraints.map(
      (item) => `CONSTRAINT: ${item}`,
    );
    const critical = [
      ...this.policy.criticalEvidence,
      ...extraCritical,
    ].map((item) => `EVIDENCE: ${item}`);

    let output = [...constraints, ...critical, body]
      .filter((part) => part.length > 0)
      .join('\n');

    if (output.length > this.policy.budget) {
      output = `${output.slice(0, this.policy.budget)}\n…(SelectiveWorkspace truncated)`;
    }

    return output;
  }
}

