/**
 * memory.ts
 *
 * Durable, typed memory for long-running sessions: feature list, progress
 * journal, artifact store, and failure memory. The feature list is the
 * Anthropic-style default-FAIL contract; only evidence can flip it.
 */

import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

import type { Ledger } from './ledger.js';
import { project } from './project.js';
import type { Belief } from './types.js';

export class ProgressJournal {
  private path: string | null;
  private lines: string[] = [];

  constructor(storeDir?: string) {
    this.path = storeDir ? resolve(storeDir, 'progress.md') : null;
    if (this.path && existsSync(this.path)) {
      this.lines = readFileSync(this.path, 'utf8')
        .split('\n')
        .filter((line) => line.trim());
    }
  }

  append(message: string): void {
    const line = `- ${new Date().toISOString()} ${message}`;
    this.lines.push(line);
    if (this.path) {
      mkdirSync(dirname(this.path), { recursive: true });
      appendFileSync(this.path, line + '\n', 'utf8');
    }
  }

  entries(): readonly string[] {
    return this.lines;
  }
}

export class ArtifactStore {
  private dir: string | null;

  constructor(storeDir?: string) {
    this.dir = storeDir ? resolve(storeDir, 'artifacts') : null;
    if (this.dir) mkdirSync(this.dir, { recursive: true });
  }

  put(name: string, content: string): string | null {
    if (!this.dir) return null;
    const target = join(this.dir, name);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content, 'utf8');
    return target;
  }
}

export interface EpisodicMemoryEntry {
  id: string;
  at: string;
  summary: string;
  context: string;
}

export class EpisodicMemory {
  private entries: EpisodicMemoryEntry[] = [];

  remember(summary: string, context = ''): EpisodicMemoryEntry {
    const entry: EpisodicMemoryEntry = {
      id: randomUUID(),
      at: new Date().toISOString(),
      summary,
      context,
    };
    this.entries.push(entry);
    return entry;
  }

  recall(predicate: (entry: EpisodicMemoryEntry) => boolean): EpisodicMemoryEntry[] {
    return this.entries.filter(predicate);
  }

  all(): readonly EpisodicMemoryEntry[] {
    return this.entries;
  }
}

export interface FailureRecord {
  id: string;
  at: string;
  operation: string;
  reason: string;
}

export class FailureMemory {
  private records: FailureRecord[] = [];

  record(operation: string, reason: string): FailureRecord {
    const record: FailureRecord = {
      id: randomUUID(),
      at: new Date().toISOString(),
      operation,
      reason,
    };
    this.records.push(record);
    return record;
  }

  all(): readonly FailureRecord[] {
    return this.records;
  }
}

export class BeliefRouter {
  constructor(private ledger: Ledger) {}

  assert(actor: string, subject: string, value: unknown) {
    return this.ledger.append({
      type: 'belief.asserted',
      actor,
      payload: { subject, value },
    });
  }

  retract(actor: string, beliefId: string) {
    const belief = project(this.ledger).beliefs.get(beliefId);
    if (!belief || belief.retracted) return null;
    return this.ledger.append({
      type: 'belief.retracted',
      actor,
      payload: { beliefId },
    });
  }

  live(): Belief[] {
    return [...project(this.ledger).beliefs.values()].filter((belief) => !belief.retracted);
  }
}
