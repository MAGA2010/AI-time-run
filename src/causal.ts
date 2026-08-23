/**
 * causal.ts
 *
 * MDIBUS 03: causal-history kernel and dependency/insulation graph. Every
 * event carries a parent link; from those links we rebuild an explicit DAG,
 * classify operations as atomic (non-interruptible) or parallel, and prove
 * that the history has no cycles.
 */

import type { Ledger } from './ledger.js';
import type { Event } from './types.js';

export interface CausalNode {
  id: string;
  type: string;
  parents: string[];
  children: string[];
}

export class CausalGraph {
  private nodes = new Map<string, CausalNode>();
  private edgeCount = 0;

  constructor(ledger: Ledger) {
    for (const event of ledger.all()) {
      this.nodes.set(event.id, {
        id: event.id,
        type: event.type,
        parents: event.parent ? [event.parent] : [],
        children: [],
      });
    }

    for (const event of ledger.all()) {
      if (!event.parent) continue;
      const parent = this.nodes.get(event.parent);
      if (parent) {
        parent.children.push(event.id);
        this.edgeCount += 1;
      }
    }
  }

  get size(): number {
    return this.nodes.size;
  }

  get edges(): number {
    return this.edgeCount;
  }

  ancestors(id: string): string[] {
    return this.walk(id, 'parents');
  }

  descendants(id: string): string[] {
    return this.walk(id, 'children');
  }

  depth(id: string): number {
    const node = this.nodes.get(id);
    if (!node) return 0;
    return node.parents.reduce(
      (max, parentId) => Math.max(max, 1 + this.depth(parentId)),
      0,
    );
  }

  cycles(): string[] {
    const result: string[] = [];
    for (const id of this.nodes.keys()) {
      if (this.ancestors(id).includes(id)) result.push(id);
    }
    return result;
  }

  isAcyclic(): boolean {
    return this.cycles().length === 0;
  }

  private walk(id: string, direction: 'parents' | 'children'): string[] {
    const seen = new Set<string>();
    const queue = [id];
    const result: string[] = [];

    while (queue.length > 0) {
      const current = queue.shift() as string;
      const node = this.nodes.get(current);
      if (!node) continue;
      for (const neighbor of node[direction]) {
        if (!seen.has(neighbor)) {
          seen.add(neighbor);
          result.push(neighbor);
          queue.push(neighbor);
        }
      }
    }

    return result;
  }
}

export type Insulation = 'atomic' | 'parallel';

export function classifyEffect(event: Event, atomicScopes: Set<string>): Insulation {
  if (event.type !== 'effect.requested') return 'parallel';
  const scope = String(event.payload.scope);
  return atomicScopes.has(scope) ? 'atomic' : 'parallel';
}
