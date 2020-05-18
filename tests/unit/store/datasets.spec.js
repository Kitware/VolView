import chai, { expect } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';

import datasets, { DataTypes, NO_SELECTION } from '@/src/store/datasets';
import { FileIO } from '@/src/io/io';
import { makeEmptyFile, makeDicomFile, vuexFakes } from '@/tests/testUtils';

chai.use(sinonChai);

function services() {
  const fileIO = new FileIO();
  fileIO.addSingleReader('nrrd', () => ({
    // simulate all vtk objects
    isA: () => true,
  }));
  fileIO.addSingleReader('bad', () => {
    throw new Error('whoops');
  });
  return { fileIO };
}

describe('Datasets module', () => {
  afterEach(() => {
    sinon.restore();
  });

  describe('File loading', () => {
    it('loadFiles action should load a list of dicom and regular files', async () => {
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

      const files = [
        makeEmptyFile('test.nrrd'),
        makeEmptyFile('test.bad'),
        makeDicomFile('file1.dcm'),
        makeDicomFile('file2.dcm'),
      ];

      const errors = await mod.actions.loadFiles(
        { state, dispatch, commit },
        files,
      );

      expect(commit).to.have.been.calledWith('addImage');
      expect(commit).to.have.been.calledWith('addDicom');
      // expect(commit).to.have.been.calledWith('addModel');

      expect(errors).to.have.lengthOf(1);
      expect(errors[0]).to.have.property('name').that.equals('test.bad');
      expect(errors[0]).to.have.property('error').that.is.a('error');
    });

    it('add* mutations should add info appropriately', () => {
      const mod = datasets(services());
      const { state } = mod;

      mod.mutations.addImage(state, {
        id: 1,
        image: {},
        name: 'myimage.jpg',
      });
      expect(state.data.imageIDs).to.have.lengthOf(1);
      expect(state.data.index)
        .to.have.property(String(1))
        .that.has.property('type', DataTypes.Image);

      mod.mutations.addDicom(state, {
        id: 2,
        patientKey: 'patientkey',
        studyKey: 'studykey',
        seriesKey: 'serieskey',
      });
      expect(state.data.dicomIDs).to.have.lengthOf(1);
      expect(state.data.index)
        .to.have.property(2)
        .that.has.property('type', DataTypes.Dicom);
      expect(state.dicomSeriesToID)
        .to.have.property('serieskey')
        .that.equals(2);

      // duplicate IDs should be ignored
      mod.mutations.addImage(state, {
        id: 1,
        image: {},
        name: 'otherimage.jpg',
      });
      expect(state.data.imageIDs).to.have.lengthOf(1);

      // TODO addModel
    });
  });

  describe('Base image selection', () => {
    it('selectBaseImage action', async () => {
      const mod = datasets(services());
      const { state } = mod;

      mod.mutations.addImage(state, {
        id: 100,
        image: {},
        name: 'somename.tiff',
      });

      const { dispatch, commit } = vuexFakes();
      mod.actions.selectBaseImage({ state, dispatch, commit }, 100);
      expect(commit).to.have.been.calledWith('selectBaseImage', 100);
      expect(commit).to.have.been.calledWith('setBaseMetadata');
      expect(dispatch).to.have.been.calledWith('updateRenderPipeline');
    });

    it('selectBaseImage mutation', () => {
      const mod = datasets(services());
      const { state } = mod;

      // invalid selection
      mod.mutations.selectBaseImage(state, 100);
      expect(state.selectedBaseImage).to.equal(NO_SELECTION);

      // valid selection
      mod.mutations.addImage(state, {
        id: 1,
        name: 'testing.bmp',
        imageData: {},
      });
      mod.mutations.selectBaseImage(state, 1);
      expect(state.selectedBaseImage).to.equal(1);
    });
  });
});
