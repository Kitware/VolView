import { expect } from 'chai';
import sinon from 'sinon';

import datasets from '@/src/store/datasets';
import { FileIO } from '@/src/io/io';
import { FileLoaded } from '@/src/types';
import DicomIO from '@/src/io/dicom';

function makeEmptyFile(name) {
  return new File([], name);
}

function vuexFakes() {
  const dispatch = sinon.fake();
  const commit = sinon.fake();
  return { dispatch, commit };
}

function services() {
  const fileIO = new FileIO();
  fileIO.addSingleReader('nrrd', (f) => f.name);
  const dicomIO = sinon.stub(new DicomIO());
  return { fileIO, dicomIO };
}

describe('Datasets module', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('should load a list of files', async () => {
    const mod = datasets(services());

    const { dispatch, commit } = vuexFakes();
    const result = await mod.actions.loadFiles(
      { dispatch, commit },
      [
        makeEmptyFile('test.nrrd'),
        makeEmptyFile('test.bad'),
      ],
    );

    const { fileResults, dicomResult } = result;
    expect(fileResults.length).to.equal(2);
    expect(
      FileLoaded.case(fileResults[0], {
        Success: (_, value) => value === 'test.nrrd',
        Failure: () => false,
      }),
    ).to.be.true;
    expect(
      FileLoaded.case(fileResults[1], {
        Success: () => false,
        Failure: (_, error) => !!error,
      }),
    ).to.be.true;
    expect(
      FileLoaded.case(dicomResult, {
        Success: () => true,
        Failure: () => false,
      }),
    ).to.be.true;
  });

  it('should handle empty array', async () => {
    const mod = datasets(services());

    const { dispatch, commit } = vuexFakes();
    const result = await mod.actions.loadFiles({ dispatch, commit }, []);
    expect(result.fileResults.length).to.equal(0);
  });
});
