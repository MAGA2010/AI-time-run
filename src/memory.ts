/**
 * memory.ts
 *
 * Durable, typed memory for long-running sessions: feature list, progress
 * journal, artifact store, and failure memory. The feature list is the
 * Anthropic-style default-FAIL contract; only evidence can flip it.
 */

import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

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
