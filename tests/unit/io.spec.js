import { expect } from 'chai';

import { FileTypes, FileLoader } from '@/src/io/io';

function makeDicomFile(name) {
  const buffer = new Uint8Array(132);
  buffer[128] = 'D'.charCodeAt(0);
  buffer[129] = 'I'.charCodeAt(0);
  buffer[130] = 'C'.charCodeAt(0);
  buffer[131] = 'M'.charCodeAt(0);
  return new File([buffer.buffer], name);
}

function makeNrrdFile(name) {
  const buffer = new Uint8Array(8);
  buffer[0] = 'N'.charCodeAt(0);
  buffer[1] = 'R'.charCodeAt(0);
  buffer[2] = 'R'.charCodeAt(0);
  buffer[3] = 'D'.charCodeAt(0);
  return new File([buffer.buffer], name);
}

describe('I/O', () => {
  it('File type works with extensions', async () => {
    const loader = new FileLoader();
    let type;
    type = await loader.getFileType(makeDicomFile('file.DCM'));
    expect(type).to.equal(FileTypes.DICOM);

    type = await loader.getFileType(makeNrrdFile('file.nrrd'));
    expect(type).to.equal('nrrd');
  });

  it('File type works without extensions', async () => {
    const loader = new FileLoader();
    let type;
    type = await loader.getFileType(makeDicomFile('file'));
    expect(type).to.equal(FileTypes.DICOM);

    type = await loader.getFileType(makeNrrdFile('file'));
    expect(type).to.equal('nrrd');
  });

  it('Async file reader should succeed', async () => {
    const loader = new FileLoader();
    const reader = async (f) => `${f.name} data`;
    loader.registerReader('nrrd', reader);

    const file = makeNrrdFile('file');
    expect(await loader.canRead(file)).to.be.true;

    const result = await loader.parseFile(file);
    expect(result).to.equal('file data');
  });

  it('Extensions with dots should be supported', async () => {
    const loader = new FileLoader();
    const reader = async (f) => `${f.name} data`;
    loader.registerReader('nrrd.gz', reader);

    const file = makeNrrdFile('file.nrrd.gz');
    expect(await loader.canRead(file)).to.be.true;
  });
});
