/**
 * environment.ts
 *
 * MDIBUS 06: real environments. The demo no longer has to mutate a fake
 * `world` object; a FileSystemAdapter gives a real write/read/exists surface
 * constrained to a root directory, plus a Tool and Probe that the runtime can
 * bind directly.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';

import type { Probe, Tool } from './types.js';

export class FileSystemAdapter {
  private root: string;

  constructor(root: string) {
    this.root = resolve(root);
    mkdirSync(this.root, { recursive: true });
  }

  private path(name: string): string {
    const target = resolve(this.root, name);
    if (!target.startsWith(this.root)) throw new Error(`path-escape:${name}`);
    return target;
  }

  write(name: string, content: string): string {
    const target = this.path(name);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content, 'utf8');
    return target;
  }

  read(name: string): string {
    return readFileSync(this.path(name), 'utf8');
  }

  exists(name: string): boolean {
    return existsSync(this.path(name));
  }

  remove(name: string): void {
    rmSync(this.path(name), { force: true });
  }
}

export function makeFileTool(
  adapter: FileSystemAdapter,
  name: string,
  file: string,
  content: string,
): Tool {
  return {
    name,
    scope: 'fs',
    description: `write ${file}`,
    run: () => adapter.write(file, content),
    snapshot: () => ({ exists: adapter.exists(file) }),
    restore: (snapshot) => {
      if (!Boolean((snapshot as { exists?: boolean }).exists)) adapter.remove(file);
    },
  };
}

export function makeFileProbe(
  adapter: FileSystemAdapter,
  file: string,
  expected: string,
): Probe {
  return {
    id: `file-probe:${file}`,
    run: () => {
      const ok = adapter.exists(file) && adapter.read(file) === expected;
      return { ok, value: adapter.exists(file) ? adapter.read(file) : null };
    },
  };
}

