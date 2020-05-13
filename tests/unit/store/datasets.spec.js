import { expect } from 'chai';
import sinon from 'sinon';

import datasets from '@/src/store/datasets';
import { FileIO } from '@/src/io/io';
import { FileLoaded } from '@/src/types';

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

function vuexFakes() {
  const dispatch = sinon.fake();
  const commit = sinon.fake();
  return { dispatch, commit };
}

function services() {
  const fileIO = new FileIO();
  fileIO.addSingleReader('nrrd', (f) => ({
    isA: (type) => type === 'vtkObject',
    name: f.name,
  }));
  return { fileIO };
}

describe('Datasets module', () => {
  afterEach(() => {
    sinon.restore();
  });

  describe('File loading', () => {
    it('should load a list of dicom and regular files', async () => {
      const mod = datasets(services());
      const { state } = mod;

      const { commit } = vuexFakes();
      const dispatch = async (actionName) => {
        if (actionName === 'dicom/importFiles') {
          return [{
            patientKey: 'patientKey',
            studyKey: 'studyKey',
            seriesKey: 'seriesKey',
          }];
        }
        return null;
      };

      const result = await mod.actions.loadFiles(
        { state, dispatch, commit },
        [
          makeEmptyFile('test.nrrd'),
          makeEmptyFile('test.bad'),
          makeDicomFile('file1.dcm'),
          makeDicomFile('file2.dcm'),
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
});
