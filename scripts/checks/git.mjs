import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

export const git = (...args) =>
  execFileSync('git', args, {
    encoding: 'utf8',
    maxBuffer: 1 << 28,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

export const paths = (text) => text.split('\0').filter(Boolean);

export const resolveCommit = (ref) =>
  git('rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`).trim();

export function changedFiles(args) {
  const entries = paths(
    git(
      'diff',
      '--name-status',
      '-z',
      '--find-renames',
      '--diff-filter=AMRT',
      ...args,
      '--'
    )
  );
  const changed = [];
  for (let i = 0; i < entries.length; ) {
    const status = entries[i++];
    const previous = entries[i++];
    const file = status.startsWith('R') ? entries[i++] : previous;
    changed.push({ file, before: status === 'A' ? undefined : previous });
  }
  return changed;
}

export function stagedContext() {
  const { values } = parseArgs({ options: { base: { type: 'string' } } });
  const worktree = git('rev-parse', '--show-toplevel').trim();
  process.chdir(worktree);
  const baseRef = values.base ?? 'HEAD';
  const base =
    baseRef === 'HEAD'
      ? resolveCommit('HEAD')
      : git('merge-base', resolveCommit(baseRef), 'HEAD').trim();
  const changed = changedFiles(['--cached', base]);
  return { base, baseRef, changed, worktree };
}

export function materialize(root, entries) {
  mkdirSync(root, { recursive: true });
  for (const [file, text] of entries) {
    if (text === undefined) continue;
    const target = path.join(root, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, text);
  }
}
