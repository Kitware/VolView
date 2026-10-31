import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import { execSync } from 'node:child_process';
import {
  exists,
  fromRoot,
  read,
  relative,
  repoRoot,
  sourcesMatching,
  walk,
} from './sourceTree';

const pkg = JSON.parse(read('package.json'));

describe('the custom itk-dicom wasm pipeline is deleted', () => {
  it('removes src/io/itk-dicom from the worktree and from git', () => {
    expect(exists('src/io/itk-dicom')).toBe(false);
    expect(exists('src/io/itk-dicom/dicom.cpp')).toBe(false);
    expect(exists('src/io/itk-dicom/CMakeLists.txt')).toBe(false);
    expect(exists('src/io/itk-dicom/emscripten-build/dicom.js')).toBe(false);
    expect(exists('src/io/itk-dicom/emscripten-build/dicom.wasm')).toBe(false);
    expect(exists('src/io/itk-dicom/emscripten-build/dicom.wasm.zst')).toBe(
      false
    );
    const tracked = execSync('git ls-files src/io/itk-dicom', {
      cwd: repoRoot,
      encoding: 'utf-8',
    }).trim();
    expect(tracked).toBe('');
  });

  it('keeps the resample pipeline and its checked in build', () => {
    expect(exists('src/io/resample/resample.cxx')).toBe(true);
    expect(exists('src/io/resample/CMakeLists.txt')).toBe(true);
    expect(exists('src/io/resample/emscripten-build/resample.js')).toBe(true);
    expect(exists('src/io/resample/emscripten-build/resample.wasm')).toBe(true);
    expect(exists('src/io/resample/emscripten-build/resample.wasm.zst')).toBe(
      true
    );
  });
});

describe('package.json build scripts', () => {
  it('drops build:dicom and build:dicom:debug', () => {
    expect(pkg.scripts).not.toHaveProperty('build:dicom');
    expect(pkg.scripts).not.toHaveProperty('build:dicom:debug');
  });

  it('runs build:all as resample then build', () => {
    expect(pkg.scripts['build:all']).toBe(
      'npm run build:resample && npm run build'
    );
  });

  it('keeps the resample build scripts untouched', () => {
    expect(pkg.scripts['build:resample']).toBe(
      'itk-wasm -s src/io/resample/ build '
    );
    expect(pkg.scripts['build:resample:debug']).toBe(
      'itk-wasm -s src/io/resample/ build -- -DCMAKE_BUILD_TYPE=Debug'
    );
  });
});

describe('bundler and tooling config', () => {
  it('drops the itk-dicom static copy target from vite.config.ts', () => {
    expect(read('vite.config.ts')).not.toMatch(/itk-dicom/);
  });

  it('keeps every other static copy target in vite.config.ts', () => {
    const viteConfig = read('vite.config.ts');
    expect(viteConfig).toMatch(
      /src\/io\/resample\/emscripten-build\/\*\*\/resample\*/
    );
    expect(viteConfig).toMatch(/@itk-wasm\/dicom/);
    expect(viteConfig).toMatch(/@itk-wasm\/image-io/);
    expect(viteConfig).toMatch(
      /@itk-wasm\/morphological-contour-interpolation/
    );
  });

  it('drops the dangling itk-dicom ignore entries', () => {
    expect(read('eslint.config.js')).not.toMatch(/itk-dicom/);
    expect(read('.prettierignore').split('\n')).not.toContain(
      'src/io/itk-dicom'
    );
  });

  it('keeps the resample ignore entries', () => {
    expect(read('eslint.config.js')).toMatch(
      /src\/io\/resample\/emscripten-build\/\*\*/
    );
    expect(read('.prettierignore').split('\n')).toContain('src/io/resample');
  });
});

describe('no stale mention of the deleted pipeline', () => {
  const TEXT = /\.(md|ts|js|json|yml|yaml|toml|html)$/;

  const checkedFiles = [
    'package.json',
    'package-lock.json',
    'vite.config.ts',
    'eslint.config.js',
    '.prettierignore',
    'tsconfig.json',
    'README.md',
    'CONTRIBUTING.md',
  ]
    .map((name) => fromRoot(name))
    .filter((file) => fs.existsSync(file))
    .concat(walk(fromRoot('docs')).filter((file) => TEXT.test(file)))
    .concat(walk(fromRoot('.github')).filter((file) => TEXT.test(file)));

  it('names itk-dicom or build:dicom in no config, doc or workflow', () => {
    const offenders = checkedFiles
      .filter((file) =>
        /itk-dicom|build:dicom/.test(fs.readFileSync(file, 'utf-8'))
      )
      .map(relative)
      .sort();
    expect(offenders).toEqual([]);
  });
});

describe('no dangling reference to the deleted wrappers in src/', () => {
  it('leaves no splitAndSort or readVolumeSlice caller', () => {
    expect(sourcesMatching(/\bsplitAndSort\b/)).toEqual([]);
    expect(sourcesMatching(/\breadVolumeSlice\b/)).toEqual([]);
  });

  it('leaves no runTask under src/io/', () => {
    expect(
      sourcesMatching(/\brunTask\b/).filter((file) =>
        file.startsWith('src/io/')
      )
    ).toEqual([]);
  });
});
