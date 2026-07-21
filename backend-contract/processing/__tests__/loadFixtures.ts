// Test helper: read the golden JSON fixtures off disk (relative to this file)
// so the vitest suites and the backend's Python loader consume the exact same
// files. Uses node fs rather than a bundler glob so the fixtures stay plain,
// tool-agnostic data both repos can load.

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, basename } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

export const fixturesRoot = resolve(here, '..', '..', 'fixtures');

export type LoadedFixture = {
  name: string;
  path: string;
  data: unknown;
};

const readJson = (path: string): unknown =>
  JSON.parse(readFileSync(path, 'utf-8'));

export const loadFixture = (relPath: string): unknown =>
  readJson(resolve(fixturesRoot, relPath));

export const loadFixtureDir = (relDir: string): LoadedFixture[] => {
  const dir = resolve(fixturesRoot, relDir);
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => ({
      name: basename(f, '.json'),
      path: resolve(dir, f),
      data: readJson(resolve(dir, f)),
    }));
};
