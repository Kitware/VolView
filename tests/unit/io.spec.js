import { expect } from 'chai';

import { FileTypes, FileIO } from '@/src/io/io';

function makeEmptyFile(name) {
  return new File([], name);
}

function makeDicomFile(name) {
  const buffer = new Uint8Array(132);
  buffer[128] = 'D'.charCodeAt(0);
  buffer[129] = 'I'.charCodeAt(0);
  buffer[130] = 'C'.charCodeAt(0);
  buffer[131] = 'M'.charCodeAt(0);
  return new File([buffer.buffer], name);
}

describe('I/O', () => {
  it('should detect dicom file type', async () => {
    const fio = new FileIO();
    let type;

    type = await fio.getFileType(makeDicomFile('file.DCM'));
    expect(type).to.equal(FileTypes.DICOM);

    type = await fio.getFileType(makeDicomFile('file'));
    expect(type).to.equal(FileTypes.DICOM);
  });

  it('should detect single files that can be handled', async () => {
    const fio = new FileIO();
    fio.addSingleReader('nii.gz', () => null);
    fio.addSingleReader('nii', () => null);
    fio.addSingleReader('jpeg', () => null);
    // all types are converted to lowercase anyways
    fio.addFileTypeAliases('jpeg', ['jpg', 'JPG']);
    let type;

    type = await fio.getFileType(makeEmptyFile('filejpeg'));
    expect(type).to.be.null;

    type = await fio.getFileType(makeEmptyFile('file.jpeg'));
    expect(type).to.equal('jpeg');

    type = await fio.getFileType(makeEmptyFile('file.JPG'));
    expect(type).to.equal('jpeg');

    // case insensitivity
    type = await fio.getFileType(makeEmptyFile('file.NII.gz'));
    expect(type).to.equal('nii.gz');

    type = await fio.getFileType(makeEmptyFile('file.nii'));
    expect(type).to.equal('nii');
  });

  it('should load files that have readers', async () => {
    const fio = new FileIO();
    fio.addSingleReader('nii.gz', () => 'nii');
    fio.addSingleReader('nii', () => 'nii');
    fio.addSingleReader('jpeg', () => 'jpeg');
    // all types are converted to lowercase anyways
    fio.addFileTypeAliases('jpeg', ['jpg', 'JPG']);

    let file;
    let data;

    file = makeDicomFile('test.dcm');
    expect(await fio.canReadFile(file)).to.be.false;

    file = makeEmptyFile('test.nii.gz');
    expect(await fio.canReadFile(file)).to.be.true;

    data = await fio.readSingleFile(makeEmptyFile('test.nii.gz'));
    expect(data).to.equal('nii');

    data = await fio.readSingleFile(makeEmptyFile('test.jpg'));
    expect(data).to.equal('jpeg');
  });
});
