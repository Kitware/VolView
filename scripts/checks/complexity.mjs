#!/usr/bin/env node
// Complexity ratchet: a changed file may not carry more debt than it did at
// the base ref, and a new file must carry none. Debt is the sum of
// (measured - limit) over every violation, so growing an already oversized
// file fails even though its violation count stays at one.
//
//   complexity.mjs --base main compares the index with merge-base(main, HEAD).
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { git, materialize, stagedContext } from './git.mjs';
import { limits as LIMITS } from './config.mjs';
const SOURCE = /^src\/.*\.(ts|js|vue)$/;
const EXCLUDED = /(__tests__|\.(spec|test)\.|\.d\.ts$|emscripten-build)/;

const { base, baseRef, changed: entries, worktree } = stagedContext();
const sources = entries.filter(
  ({ file }) => SOURCE.test(file) && !EXCLUDED.test(file)
);
const changed = sources.map(({ file }) => file);
if (changed.length === 0) process.exit(0);

const req = createRequire(path.join(worktree, 'package.json'));
const { ESLint } = req('eslint');
const vueParser = req('vue-eslint-parser');
const { parser: tsParser } = req('typescript-eslint');

const rules = Object.fromEntries(
  Object.entries(LIMITS).map(([rule, limit]) => [
    rule,
    [
      'error',
      rule === 'max-lines'
        ? { max: limit, skipBlankLines: true, skipComments: true }
        : limit,
    ],
  ])
);

const lint = async (cwd) => {
  const eslint = new ESLint({
    cwd,
    overrideConfigFile: true,
    errorOnUnmatchedPattern: false,
    allowInlineConfig: false,
    overrideConfig: [
      {
        files: ['**/*.{ts,js,vue}'],
        languageOptions: {
          parser: vueParser,
          parserOptions: {
            parser: tsParser,
            ecmaVersion: 'latest',
            sourceType: 'module',
            extraFileExtensions: ['.vue'],
          },
        },
        rules,
      },
    ],
  });
  const results = await eslint.lintFiles(['**/*.{ts,js,vue}']);
  return results.map((r) => ({
    file: path.relative(cwd, r.filePath),
    messages: r.messages,
  }));
};

// Core rule messages carry the measured value as "(N)" or "of N." and the
// limit as "Maximum allowed is N".
const debtOf = (message) => {
  const measured = message.match(/\((\d+)\)|of (\d+)\./);
  const limit = message.match(/Maximum allowed is (\d+)/);
  if (!measured || !limit)
    throw new Error(`Unrecognized rule diagnostic: ${message}`);
  return Number(measured[1] ?? measured[2]) - Number(limit[1]);
};

const debtByFile = (results) =>
  Object.fromEntries(
    results.map(({ file, messages }) => [
      file,
      messages.reduce((acc, m) => {
        if (!m.ruleId) throw new Error(`${file}:${m.line}: ${m.message}`);
        const rule = m.ruleId;
        return { ...acc, [rule]: (acc[rule] ?? 0) + debtOf(m.message) };
      }, {}),
    ])
  );

const tmp = mkdtempSync(path.join(tmpdir(), 'ratchet-'));
try {
  const candRoot = path.join(tmp, 'cand');
  const baseRoot = path.join(tmp, 'base');
  materialize(
    candRoot,
    sources.map(({ file }) => [file, git('show', `:${file}`)])
  );
  materialize(
    baseRoot,
    sources.map(({ file, before }) => [
      file,
      before === undefined ? undefined : git('show', `${base}:${before}`),
    ])
  );

  const [cand, before] = await Promise.all([lint(candRoot), lint(baseRoot)]);
  const candDebt = debtByFile(cand);
  const baseDebt = debtByFile(before);

  const regressions = changed.flatMap((file) =>
    Object.entries(candDebt[file] ?? {})
      .filter(([rule, debt]) => debt > (baseDebt[file]?.[rule] ?? 0))
      .map(([rule, debt]) => ({
        file,
        rule,
        debt,
        was: baseDebt[file]?.[rule] ?? 0,
      }))
  );

  if (regressions.length > 0) {
    console.error(
      '\nComplexity ratchet: these files got worse than %s.\n',
      baseRef
    );
    regressions.forEach(({ file, rule, was, debt }) => {
      console.error(`  ${file}  ${rule}  debt ${was} -> ${debt}`);
      const offending = cand.find((r) => r.file === file)?.messages ?? [];
      offending
        .filter((m) => (m.ruleId ?? 'parse-error') === rule)
        .forEach((m) => console.error(`      ${file}:${m.line}  ${m.message}`));
    });
    console.error(
      `\nLimits: ${Object.entries(LIMITS)
        .map(([r, l]) => `${r} ${l}`)
        .join(
          ', '
        )}. Reduce the debt to at most the base value, or split the file.` +
        `\nBypass additional checks for one commit with CHECKS_SKIP=1.\n`
    );
    process.exitCode = 1;
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
