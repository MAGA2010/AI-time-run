/**
 * sandbox.ts
 *
 * The "hands". Tools run here, isolated from the reasoner. Every tool has a
 * capability scope, a snapshot, and a restore, so faults are contained and
 * effects can be reverted without touching the brain or the ledger.
 *
 * The sandbox also enforces idempotency for tool execution: a given
 * (tool, scope, payload) tuple, identified by SHA-256, returns its prior
 * outcome on retries so the harness never double-applies a side effect.
 */

import { idempotencyKeyFor } from './ledger.js';
import type { SandboxResult, Tool } from './types.js';

export interface ExecuteOptions {
  /** Optional idempotency key; if omitted, derived from the call inputs. */
  idempotencyKey?: string;
  /** Optional featureId, used to scope the derived idempotency key. */
  featureId?: string;
  /** Optional payload snapshot used to derive the idempotency key. */
  payload?: Record<string, unknown>;
}

interface CachedExecution {
  key: string;
  result: SandboxResult;
  at: number;
}

export class Sandbox {
  private tools = new Map<string, Tool>();
  private cache = new Map<string, CachedExecution>();

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

  async execute(name: string, input: Record<string, unknown>, opts: ExecuteOptions = {}): Promise<SandboxResult & { deduped?: boolean; idempotencyKey: string }> {
    const tool = this.tools.get(name);
    if (!tool) return { ok: false, error: `unknown-tool:${name}`, idempotencyKey: '' };

    const key = opts.idempotencyKey
      ?? idempotencyKeyFor({
        tool: name,
        scope: tool.scope,
        featureId: opts.featureId ?? '',
        payload: opts.payload ?? input,
      });

    const prior = this.cache.get(key);
    if (prior) return { ...prior.result, deduped: true, idempotencyKey: key };

    try {
      const output = await tool.run(input);
      const result: SandboxResult = { ok: true, output };
      this.cache.set(key, { key, result, at: Date.now() });
      return { ...result, idempotencyKey: key };
    } catch (error) {
      const result: SandboxResult = { ok: false, error: error instanceof Error ? error.message : String(error) };
      this.cache.set(key, { key, result, at: Date.now() });
      return { ...result, idempotencyKey: key };
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
