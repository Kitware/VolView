import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as dicomIo from '@/src/io/dicom';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..'
);

const source = fs.readFileSync(path.join(repoRoot, 'src/io/dicom.ts'), 'utf-8');

const sourceFrom = (marker: string) => {
  const start = source.indexOf(marker);
  return start === -1 ? '' : source.slice(start);
};

describe('src/io/dicom.ts runtime surface', () => {
  it('drops splitAndSort, readVolumeSlice and readTags', () => {
    const exported = Object.keys(dicomIo);
    expect(exported).not.toContain('splitAndSort');
    expect(exported).not.toContain('readVolumeSlice');
    expect(exported).not.toContain('readTags');
    expect(exported.sort()).toEqual(['readDicomSegmentation']);
  });

  it('keeps readDicomSegmentation, the DICOM SEG reader', () => {
    expect(typeof dicomIo.readDicomSegmentation).toBe('function');
  });
});

describe('src/io/dicom.ts source', () => {
  it('drops the runTask itk-wasm pipeline runner and its plumbing', () => {
    expect(source).not.toMatch(/\brunTask\b/);
    expect(source).not.toMatch(/runPipeline/);
    expect(source).not.toMatch(/itkConfig/);
    expect(source).not.toMatch(/InterfaceTypes/);
    expect(source).not.toMatch(/TextStream/);
  });

  it('drops the custom pipeline actions it used to dispatch', () => {
    expect(source).not.toMatch(/--action/);
    expect(source).not.toMatch(/categorize/);
    expect(source).not.toMatch(/getSliceImage/);
    expect(source).not.toMatch(/--memory-io/);
  });

  it('no longer calls itk-wasm readDicomTags', () => {
    expect(source).not.toMatch(/readDicomTags/);
  });

  it('drops the types that only typed the deleted wrappers', () => {
    expect(source).not.toMatch(/\bTagSpec\b/);
    expect(source).not.toMatch(/\bVolumesToFileNamesMap\b/);
  });

  it('keeps the SEG reader reading a name sanitized file', () => {
    expect(source).toMatch(/function sanitizeFile\b/);
    const readDicomSegmentation = sourceFrom(
      'export async function readDicomSegmentation'
    );
    expect(readDicomSegmentation).toMatch(/sanitizeFile\(file\)/);
    expect(readDicomSegmentation).toMatch(/readOverlappingSegmentation\(/);
    expect(readDicomSegmentation).toMatch(/mergeSegments: true/);
  });
});
