#!/usr/bin/env node
// Two checks that need no judgement: no committed binaries outside the
// directories that hold them, and no drift between a feature's modules on disk
// and the hand-maintained upper-module list its pure layer is guarded against.
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { git, stagedContext } from './git.mjs';

// The directories that already track binaries: visual baselines, documentation
// and application images, the favicons, and the itk wasm build output. Editing
// one of those is routine; a binary anywhere else is what this check is for.
const BINARY_DIRS = [
  'tests/baseline/',
  'docs/assets/',
  'docs/public/',
  'public/',
  'src/assets/',
  'src/io/itk-dicom/emscripten-build/',
  'src/io/resample/emscripten-build/',
];
const { base, changed, worktree } = stagedContext();

const failures = [];

// git reports "-" for added and deleted lines when a blob is binary.
const numstat = git('diff', '--cached', '--numstat', base, '--');
numstat
  .split('\n')
  .filter(Boolean)
  .map((line) => line.split('\t'))
  .filter(([added, removed, file]) => added === '-' && removed === '-' && file)
  .filter(([, , file]) => !BINARY_DIRS.some((dir) => file.startsWith(dir)))
  .forEach(([, , file]) =>
    failures.push(
      `${file} is a binary file. Generate test data (tests/specs/syntheticDicom.ts) or download it lazily; committed binaries belong in ${BINARY_DIRS.join(', ')}.`
    )
  );

// Staged content, like complexity.mjs and duplication.mjs: an unstaged config
// edit must not satisfy the gate for a commit that does not carry it.
const config = git('show', ':eslint.config.js');
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
// Every module file under src/<dir>, nested ones included: a coordinator added
// under editing/ or masks/ needs an upperModules entry just as a top-level one does.
const modulesUnder = (dir, prefix = '') =>
  readdirSync(path.join(worktree, 'src', dir, prefix), { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith('__'))
    .flatMap((entry) => {
      if (entry.isDirectory())
        return modulesUnder(dir, `${prefix}${entry.name}/`);
      return /\.(ts|js|vue)$/.test(entry.name)
        ? [`${prefix}${entry.name}`]
        : [];
    });
const stripExtension = (name) => name.replace(/\.(ts|js|vue)$/, '');
// `pure.files` holds globs, so a nested pure file has to be matched as one.
const globToRegExp = (pattern) =>
  new RegExp(
    `^${pattern.replace(/\*\*\/?|\*|\{[^}]*\}|[.+^$()|[\]\\]/g, (token) => {
      if (token.startsWith('**')) return '(?:.*/)?';
      if (token === '*') return '[^/]*';
      if (token.startsWith('{'))
        return `(?:${token.slice(1, -1).split(',').join('|')})`;
      return `\\${token}`;
    })}$`
  );

features.forEach((dir) => {
  // A feature the lint config lists ahead of its directory has nothing to check.
  if (!existsSync(path.join(worktree, 'src', dir))) return;
  const listed = listAfter(dir).map(stripExtension);
  const pure = pureFilesFor(dir).map(globToRegExp);
  const covered = (module, file) =>
    listed.includes(module) ||
    listed.some(
      (entry) =>
        entry.endsWith('/**') &&
        (module === entry.slice(0, -3) || module.startsWith(entry.slice(0, -2)))
    ) ||
    pure.some((pattern) => pattern.test(file));
  modulesUnder(dir)
    .map((relative) => [stripExtension(relative), `src/${dir}/${relative}`])
    .filter(([, file]) => added.has(file))
    .filter(([module, file]) => !covered(module, file))
    .forEach(([module]) =>
      failures.push(
        `src/${dir}/${module} is neither a pure file nor in ${dir}'s upperModules, so the pure layer may import it while lint stays green.`
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
