#!/usr/bin/env node
// Two checks that need no judgement: no committed binaries outside the visual
// baseline directory, and no drift between a feature's modules on disk and the
// hand-maintained upper-module list its pure layer is guarded against.
import { readFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { git, stagedContext } from './git.mjs';

const BASELINE = 'tests/baseline/';
const { base, changed, worktree } = stagedContext();

const failures = [];

// git reports "-" for added and deleted lines when a blob is binary.
const numstat = git('diff', '--cached', '--numstat', base, '--');
numstat
  .split('\n')
  .filter(Boolean)
  .map((line) => line.split('\t'))
  .filter(([added, removed, file]) => added === '-' && removed === '-' && file)
  .filter(([, , file]) => !file.startsWith(BASELINE))
  .forEach(([, , file]) =>
    failures.push(
      `${file} is a binary file. Generate test data (tests/specs/syntheticDicom.ts) or download it lazily; only ${BASELINE} holds committed binaries.`
    )
  );

const config = readFileSync(path.join(worktree, 'eslint.config.js'), 'utf8');
const features = [...config.matchAll(/dir: '([^']+)',\s*pure: \{/g)].map(
  (match) => match[1]
);
const listAfter = (dir) => {
  const start = config.indexOf(`dir: '${dir}'`);
  const open = config.indexOf('upperModules: [', start);
  const close = config.indexOf(']', open);
  return (config.slice(open, close).match(/'[^']+'/g) ?? []).map((entry) =>
    entry.slice(1, -1)
  );
};
const pureFilesFor = (dir) => {
  const start = config.indexOf(`dir: '${dir}'`);
  const open = config.indexOf('files: [', start);
  const close = config.indexOf(']', open);
  return (config.slice(open, close).match(/'[^']+'/g) ?? []).map((entry) =>
    entry.slice(1, -1)
  );
};

// Only modules added by this change: pre-existing gaps are debt, not a regression.
const added = new Set(
  changed.filter(({ before }) => before === undefined).map(({ file }) => file)
);
features.forEach((dir) => {
  const listed = listAfter(dir);
  const pure = pureFilesFor(dir);
  const onDisk = readdirSync(path.join(worktree, 'src', dir), {
    withFileTypes: true,
  })
    .filter((entry) => !entry.name.startsWith('__'))
    .filter((entry) => entry.isDirectory() || /\.(ts|js|vue)$/.test(entry.name))
    .map((entry) => entry.name.replace(/\.(ts|js|vue)$/, ''));
  const covered = (name) =>
    listed.includes(name) ||
    listed.some(
      (entry) => entry.endsWith('/**') && entry.slice(0, -3) === name
    ) ||
    pure.some((file) => file.startsWith(`src/${dir}/${name}`));
  onDisk
    .filter((name) =>
      [...added].some((file) => file.startsWith(`src/${dir}/${name}`))
    )
    .filter((name) => !covered(name))
    .forEach((name) =>
      failures.push(
        `src/${dir}/${name} is neither a pure file nor in ${dir}'s upperModules, so the pure layer may import it while lint stays green.`
      )
    );
});

if (failures.length > 0) {
  console.error('\nConventions:\n');
  failures.forEach((failure) => console.error(`  ${failure}`));
  console.error(
    '\nBypass additional checks for one commit with CHECKS_SKIP=1.\n'
  );
  process.exitCode = 1;
}
