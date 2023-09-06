import { describe, it } from 'vitest';
import { expect } from 'chai';
import { retypeFile } from '@/src/io';

function makeEmptyFile(name: string) {
  return new File([], name);
}

function makeDicomFile(name: string) {
  const buffer = new Uint8Array(132);
  buffer[128] = 'D'.charCodeAt(0);
  buffer[129] = 'I'.charCodeAt(0);
  buffer[130] = 'C'.charCodeAt(0);
  buffer[131] = 'M'.charCodeAt(0);
  return new File([buffer.buffer], name);
}

describe('I/O', () => {
  it('should detect dicom files', async () => {
    expect((await retypeFile(makeDicomFile('file.DCM'))).type).to.equal(
      'application/dicom'
    );
    expect((await retypeFile(makeDicomFile('somedicom'))).type).to.equal(
      'application/dicom'
    );
  });

  it('should retype files based on extension', async () => {
    expect((await retypeFile(makeEmptyFile('test.VTI'))).type).to.equal(
      'application/vnd.unknown.vti'
    );
  });
});
