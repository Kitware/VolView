import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import {
  exists,
  read,
  relative,
  sourceFiles,
  sourcesMatching,
} from './sourceTree';

describe('one DICOM import processor', () => {
  it('keeps handleDicom and drops the file and stream processors', () => {
    expect(exists('src/io/import/processors/handleDicom.ts')).toBe(true);
    expect(exists('src/io/import/processors/handleDicomFile.ts')).toBe(false);
    expect(exists('src/io/import/processors/handleDicomStream.ts')).toBe(false);
  });

  it('registers handleDicom in the import chain, and nothing it replaced', () => {
    const chain = read('src/io/import/importDataSources.ts');
    expect(chain).toMatch(/\bhandleDicom\b/);
    expect(chain).not.toMatch(/handleDicomFile|handleDicomStream/);
  });
});

describe('one DICOM meta loader', () => {
  it('drops the file meta loader', () => {
    expect(exists('src/core/streaming/dicom/dicomFileMetaLoader.ts')).toBe(
      false
    );
    expect(exists('src/core/streaming/dicom/dicomMetaLoader.ts')).toBe(true);
  });

  it('drops the fake Pixel Data element', () => {
    expect(sourcesMatching(/generateEmptyPixelData/)).toEqual([]);
  });
});

describe('the JS reader is the only DICOM tag reader', () => {
  it('leaves no @itk-wasm/dicom readDicomTags import in src/', () => {
    const offenders = sourceFiles()
      .filter((file) =>
        /import[^;]*\breadDicomTags\b[^;]*from\s*'@itk-wasm\/dicom'/s.test(
          fs.readFileSync(file, 'utf-8')
        )
      )
      .map(relative)
      .sort();
    expect(offenders).toEqual([]);
  });

  it('keeps src/io/readDicomTags.ts as the reader every loader uses', () => {
    expect(exists('src/io/readDicomTags.ts')).toBe(true);
    expect(read('src/core/streaming/dicom/dicomMetaLoader.ts')).toMatch(
      /@\/src\/io\/readDicomTags/
    );
  });
});

describe('the itk worker warm-up', () => {
  const worker = () => read('src/io/itk/worker.ts');

  it('no longer warms readDicomTags', () => {
    expect(worker()).not.toMatch(/\breadDicomTags\b/);
  });

  it('still warms readImage', () => {
    expect(worker()).toMatch(/\breadImage\b/);
  });
});
