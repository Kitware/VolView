#!/usr/bin/env node
// A check that needs no judgement: no committed binaries outside the
// directories that hold them.
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
const { base } = stagedContext();

const failures = [];

// git reports "-" for added and deleted lines when a blob is binary.
const numstat = git(
  'diff',
  '--cached',
  '--numstat',
  '--diff-filter=AMRT',
  base,
  '--'
);
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

if (failures.length > 0) {
  console.error('\nConventions:\n');
  failures.forEach((failure) => console.error(`  ${failure}`));
  console.error(
    '\nBypass additional checks for one commit with CHECKS_SKIP=1.\n'
  );
  process.exitCode = 1;
}
