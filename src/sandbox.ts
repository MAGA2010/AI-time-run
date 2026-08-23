/**
 * sandbox.ts
 *
 * The "hands". Tools run here, isolated from the reasoner. Every tool has a
 * capability scope, a snapshot, and a restore, so faults are contained and
 * effects can be reverted without touching the brain or the ledger.
 */

import type { SandboxResult, Tool } from './types.js';

export class Sandbox {
  private tools = new Map<string, Tool>();

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  tool(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  names(): string[] {
    return [...this.tools.keys()];
  }

  async execute(name: string, input: Record<string, unknown>): Promise<SandboxResult> {
    const tool = this.tools.get(name);
    if (!tool) return { ok: false, error: `unknown-tool:${name}` };

    // Fault isolation: a crash in the hands never crashes the harness.
    try {
      const output = await tool.run(input);
      return { ok: true, output };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  snapshot(): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [name, tool] of this.tools) result[name] = tool.snapshot();
    return result;
  }

  restore(snapshot: Record<string, unknown>): void {
    for (const [name, value] of Object.entries(snapshot)) {
      const tool = this.tools.get(name);
      if (tool) tool.restore(value);
    }
  }
}
