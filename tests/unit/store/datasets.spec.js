import chai, { expect } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';

import vtkImageData from 'vtk.js/Sources/Common/DataModel/ImageData';

import datasets, { DataTypes, NO_SELECTION } from '@/src/store/datasets';
import { FileIO } from '@/src/io/io';
import { makeEmptyFile, makeDicomFile, vuexFakes } from '@/tests/testUtils';

chai.use(sinonChai);

function dependencies() {
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
  let deps;
  let mod;
  let state;

  beforeEach(() => {
    deps = dependencies();
    mod = datasets(deps);
    ({ state } = mod);
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('File loading', () => {
    it('loadFiles action should load a list of dicom and regular files', async () => {
      const fakes = vuexFakes();
      fakes.dispatch = sinon
        .stub()
        .withArgs('dicom/importFiles')
        .returns([{
          patientKey: 'patientKey',
          studyKey: 'studyKey',
          seriesKey: 'seriesKey',
        }]);

      const files = [
        makeEmptyFile('test.nrrd'),
        makeEmptyFile('test.bad'),
        makeDicomFile('file1.dcm'),
        makeDicomFile('file2.dcm'),
      ];

      const errors = await mod.actions.loadFiles(
        { state, ...fakes },
        files,
      );

      expect(fakes.commit).to.have.been.calledWith('addImage');
      expect(fakes.commit).to.have.been.calledWith('addDicom');
      // expect(commit).to.have.been.calledWith('addModel');

      expect(errors).to.have.lengthOf(1);
      expect(errors[0]).to.have.property('name').that.equals('test.bad');
      expect(errors[0]).to.have.property('error').that.is.a('error');
    });

    it('addImage mutations', () => {
      mod.mutations.addImage(state, {
        id: 1,
        image: {},
        name: 'myimage.jpg',
      });
      expect(state.data.imageIDs).to.have.lengthOf(1);
      expect(state.data.index)
        .to.have.property(String(1))
        .that.has.property('type', DataTypes.Image);
    });

    it('addDicom mutations', () => {
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
    });

    it('addImage duplicate IDs should be ignored', () => {
      // duplicate IDs should be ignored
      mod.mutations.addImage(state, {
        id: 1,
        image: {},
        name: 'otherimage.jpg',
      });
      expect(state.data.imageIDs).to.have.lengthOf(1);
    });

    // TODO addModel
  });

  describe('Base image selection', () => {
    it('selectBaseImage action', async () => {
      const image = vtkImageData.newInstance();
      mod.mutations.addImage(state, {
        id: 100,
        imageData: image,
        name: 'somename.tiff',
      });

      state.selectedBaseImage = 100;

      const { dispatch, commit } = vuexFakes();
      mod.actions.selectBaseImage({ state, dispatch, commit }, 100);
      expect(commit).to.have.been.calledWith('selectBaseImage', 100);
      expect(commit).to.have.been.calledWith('setBaseMetadata');
      expect(dispatch).to.have.been.calledWith('updateRenderPipeline');
    });

    it('selectBaseImage mutation', () => {
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
