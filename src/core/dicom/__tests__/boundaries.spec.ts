import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

// The planner decides what collections a series holds. It must stay usable
// outside VolView: no renderer, no application state, no UI framework.
const FORBIDDEN = [
  '@kitware/vtk.js',
  'itk-wasm',
  '@itk-wasm/',
  'pinia',
  "from 'vue'",
  '@/src/store/',
  '@/src/components/',
  '@/src/io/',
];

const dicomDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);

const sources = fs
  .readdirSync(dicomDir)
  .filter((name) => name.endsWith('.ts'))
  .map((name) => ({
    name,
    text: fs.readFileSync(path.join(dicomDir, name), 'utf-8'),
  }));

describe('src/core/dicom boundaries', () => {
  it('covers the planner modules', () => {
    expect(sources.map(({ name }) => name).sort()).toEqual([
      'assignCollectionIds.ts',
      'collectionRegistry.ts',
      'instanceFacts.ts',
      'planDicomCollections.ts',
      'reconstructVolume.ts',
      'splitOverlappingAcquisitions.ts',
    ]);
  });

  it.each(sources.map(({ name }) => name))(
    '%s imports no renderer, store, or UI framework',
    (name) => {
      const { text } = sources.find((source) => source.name === name)!;
      const imports = text
        .split('\n')
        .filter((line) => /^import\b|^} from\b|\bfrom '/.test(line));
      FORBIDDEN.forEach((needle) => {
        expect(imports.join('\n')).not.toContain(needle);
      });
    }
  );
});
