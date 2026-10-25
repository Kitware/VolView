/** Repo file lookups for specs that assert on the shape of the tree itself. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..'
);

export const fromRoot = (...parts: string[]) => path.join(repoRoot, ...parts);

export const read = (...parts: string[]) =>
  fs.readFileSync(fromRoot(...parts), 'utf-8');

export const exists = (...parts: string[]) => fs.existsSync(fromRoot(...parts));

export const relative = (file: string) => path.relative(repoRoot, file);

const SKIP_DIRS = new Set(['node_modules', '__tests__', 'emscripten-build']);

export const walk = (dir: string): string[] =>
  fs.existsSync(dir)
    ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        if (SKIP_DIRS.has(entry.name)) return [];
        const full = path.join(dir, entry.name);
        return entry.isDirectory() ? walk(full) : [full];
      })
    : [];

export const sourceFiles = () =>
  walk(fromRoot('src')).filter((file) => /\.(ts|js|vue)$/.test(file));

export const sourcesMatching = (pattern: RegExp) =>
  sourceFiles()
    .filter((file) => pattern.test(fs.readFileSync(file, 'utf-8')))
    .map(relative)
    .sort();
