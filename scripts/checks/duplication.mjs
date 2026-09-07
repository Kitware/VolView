#!/usr/bin/env node
// Test duplication ratchet: the staged tests may not introduce a clone that
// did not already exist at the base ref.
//
//   duplication.mjs --base main compares the index with merge-base(main, HEAD).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { git, materialize, paths, stagedContext } from './git.mjs';
import { minCloneTokens as MIN_TOKENS } from './config.mjs';

const TEST = /(__tests__\/.*|\.(spec|test)|^tests\/.*)\.[cm]?[jt]sx?$/;

const { base, baseRef, changed: entries, worktree } = stagedContext();
const changed = entries.filter(({ file }) => TEST.test(file));
if (changed.length === 0) process.exit(0);

const ts = createRequire(path.join(worktree, 'package.json'))('typescript');
const indexTests = paths(git('ls-files', '-z')).filter((f) => TEST.test(f));
const baseTests = paths(git('ls-tree', '-rz', '--name-only', base)).filter(
  (f) => TEST.test(f)
);

const withoutImports = (file, text) => {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false);
  let result = text;
  // Blank complete imports before tokenization, preserving diagnostic line numbers.
  [...source.statements].reverse().forEach((statement) => {
    if (
      !ts.isImportDeclaration(statement) &&
      !ts.isImportEqualsDeclaration(statement)
    )
      return;
    const start = statement.getStart(source);
    const end = statement.end;
    result =
      result.slice(0, start) +
      result.slice(start, end).replace(/[^\r\n]/g, ' ') +
      result.slice(end);
  });
  return result;
};

// jscpd reports a basename with no directory, and this repo has test files
// that share one, so each file is materialized under a flattened name that
// round-trips to its real path.
const flatten = (file) => file.replaceAll('/', '%');
const unflatten = (name) => name.replaceAll('%', '/');

const jscpd = path.join(worktree, 'node_modules/.bin/jscpd');
const run = (root, args) =>
  execFileSync(
    jscpd,
    [
      '--min-tokens',
      String(MIN_TOKENS),
      '--format',
      'typescript,tsx,javascript,jsx',
      ...args,
      '.',
    ],
    { cwd: root, encoding: 'utf8', stdio: ['ignore', 'ignore', 'pipe'] }
  );

const tmp = mkdtempSync(path.join(tmpdir(), 'dupes-'));
try {
  const candRoot = path.join(tmp, 'cand');
  const baseRoot = path.join(tmp, 'base');
  const baseline = path.join(tmp, 'baseline.json');
  const report = path.join(tmp, 'report');

  materialize(
    candRoot,
    indexTests.map((f) => [flatten(f), withoutImports(f, git('show', `:${f}`))])
  );
  materialize(
    baseRoot,
    baseTests.map((f) => [
      flatten(f),
      withoutImports(f, git('show', `${base}:${f}`)),
    ])
  );

  // Fingerprints are content-derived, so a baseline taken from the base tree
  // identifies exactly the clones the staged tests add.
  run(baseRoot, ['--baseline', baseline, '--update-baseline', '-r', 'silent']);
  run(candRoot, ['--baseline', baseline, '-r', 'json', '-o', report]);

  const { duplicates } = JSON.parse(
    readFileSync(path.join(report, 'jscpd-report.json'), 'utf8')
  );
  const added = duplicates.filter((clone) => clone.isNew);

  if (added.length > 0) {
    console.error('\nTest duplication ratchet: these clones are new since %s.\n', baseRef);
    added.forEach(({ firstFile, secondFile, tokens }) => {
      console.error(
        `  ${unflatten(firstFile.name)}:${firstFile.start}-${firstFile.end}` +
          `  ==  ${unflatten(secondFile.name)}:${secondFile.start}-${secondFile.end}` +
          `  (${tokens} tokens)`
      );
    });
    console.error(
      `\nA clone is ${MIN_TOKENS}+ identical tokens. Pull the shared setup into a helper the existing specs already use.` +
        `\nBypass additional checks for one commit with CHECKS_SKIP=1.\n`
    );
    process.exitCode = 1;
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
