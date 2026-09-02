import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Shared scaffolding for the specs that grep the tree instead of importing it.
// Every path here is repo-relative and POSIX-keyed, so a spec's own path
// constants compare equal on Windows too.

export const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..'
);

const SOURCE_EXTENSIONS = ['.ts', '.js', '.vue'];
const SKIPPED_DIRS = new Set(['node_modules', 'emscripten-build', 'dist']);

const toPosix = (rel: string) => rel.split(path.sep).join('/');

const relativeToRoot = (full: string) => toPosix(path.relative(repoRoot, full));

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return SKIPPED_DIRS.has(entry.name) ? [] : walk(full);
    }
    return SOURCE_EXTENSIONS.includes(path.extname(entry.name)) ? [full] : [];
  });
}

/**
 * Every source file under `dirs`, minus the calling spec: pass
 * `import.meta.url` so a spec never audits its own literals.
 */
export function sourceFiles(specUrl: string, ...dirs: string[]) {
  const self = relativeToRoot(fileURLToPath(specUrl));
  return dirs
    .flatMap((dir) => walk(path.resolve(repoRoot, dir)))
    .map(relativeToRoot)
    .filter((rel) => rel !== self);
}

export const read = (rel: string) =>
  fs.readFileSync(path.resolve(repoRoot, rel), 'utf-8');

export const exists = (rel: string) =>
  fs.existsSync(path.resolve(repoRoot, rel));

export const isTest = (rel: string) => rel.split('/').includes('__tests__');

/** `file:line` for every line of `files` matching `pattern`. */
export function hits(files: string[], pattern: RegExp) {
  return files.flatMap((rel) =>
    read(rel)
      .split('\n')
      .flatMap((line, index) =>
        pattern.test(line) ? [`${rel}:${index + 1}`] : []
      )
  );
}
