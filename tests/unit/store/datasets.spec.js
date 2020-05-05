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
  fileIO.addSingleReader('nrrd', (f) => ({
    vtkClass: 'vtkTest',
    name: f.name,
  }));
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

    expect(commit.args[0][0]).to.equal('addData');

    const { fileResults, dicomResult } = result;
    expect(fileResults.length).to.equal(2);
    expect(
      FileLoaded.mapSuccess(
        fileResults[0],
        (_, value) => value.name === 'test.nrrd',
      ),
    ).to.be.true;
    expect(FileLoaded.isFailure(fileResults[1])).to.be.true;
    expect(FileLoaded.isSuccess(dicomResult)).to.be.true;
  });

  it('should handle empty array', async () => {
    const mod = datasets(services());

    const { dispatch, commit } = vuexFakes();
    const result = await mod.actions.loadFiles({ dispatch, commit }, []);
    expect(result.fileResults.length).to.equal(0);
  });
});
