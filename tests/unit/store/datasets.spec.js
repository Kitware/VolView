import chai, { expect } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';

import vtkImageData from 'vtk.js/Sources/Common/DataModel/ImageData';

import { mutations, makeActions } from '@/src/store/datasets';
import { initialState } from '@/src/store';
import { NO_SELECTION } from '@/src/constants';
import { FileIO } from '@/src/io/io';
import { makeEmptyFile, makeDicomFile } from '@/tests/testUtils';

chai.use(sinonChai);

function dependencies() {
  const fileIO = new FileIO();
  return { fileIO };
}

describe('Datasets module', () => {
  let deps;
  let context;
  let actions;

  beforeEach(() => {
    deps = dependencies();
    actions = makeActions(deps);
    context = {
      state: initialState(),
      dispatch: sinon.spy(),
      commit: sinon.stub().callsFake((mutation) => {
        // is this assertion necessary
        if (!(mutation in mutations)) {
          throw new Error(`mutation ${mutation} not found`);
        }
      }),
    };
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('File loading', () => {
    let dummyProxy;
    let dummyVtkData;
    beforeEach(() => {
      dummyVtkData = {
        // simulate all vtk objects
        isA: () => true,
      };
      dummyProxy = {
        setInputData: () => {},
        getProxyId: () => {},
      };

      deps.fileIO.addSingleReader('nrrd', () => dummyVtkData);
      deps.fileIO.addSingleReader('bad', () => {
        throw new Error('whoops');
      });
      deps.proxyManager = {
        createProxy: () => dummyProxy,
      };
    });

    it('loadRegularFiles should load readable files', async () => {
      // we care about data being saved into proxy manager
      const mock = sinon.mock(dummyProxy);
      sinon.stub(dummyProxy, 'getProxyId').returns(1);
      mock.expects('setInputData').once();

      const files = [makeEmptyFile('test.nrrd')];
      const errors = await actions.loadRegularFiles(context, files);

      expect(errors).to.have.lengthOf(0);
      expect(context.commit).to.have.been.calledWith('addImage', {
        name: 'test.nrrd',
        image: dummyVtkData,
      });
    });

    it('loadRegularFiles should error on unreadable files', async () => {
      const files = [makeEmptyFile('test.bad')];
      const errors = await actions.loadRegularFiles(context, files);

      expect(errors).to.have.lengthOf(1);
    });

    it('loadRegularFiles should handle dicom', async () => {
      context.dispatch = sinon.stub()
        .withArgs('dicom/importFiles')
        .returns([{
          patientKey: 'patient1',
          studyKey: 'study1',
          seriesKey: 'series1',
        }]);

      const files = [
        makeDicomFile('file1.dcm'),
        makeDicomFile('file2.dcm'),
      ];

      const errors = await actions.loadDicomFiles(context, files);

      expect(errors).to.have.lengthOf(0);
      expect(context.commit).to.have.been.calledWith('addDicom', {
        patientKey: 'patient1',
        studyKey: 'study1',
        seriesKey: 'series1',
      });
    });

    it('loadFiles should separate dicom and regular files', async () => {
      const dicomFiles = [
        makeDicomFile('file1.dcm'),
        makeDicomFile('file2.dcm'),
      ];
      const regularFiles = [
        makeEmptyFile('file1.nrrd'),
        makeEmptyFile('file2.nrrd'),
      ];
      const files = [...regularFiles, ...dicomFiles];

      await actions.loadFiles(context, files);

      expect(context.dispatch)
        .to.have.been.calledWith('loadDicomFiles', dicomFiles);
      expect(context.dispatch)
        .to.have.been.calledWith('loadRegularFiles', regularFiles);
    });
  });

  describe('Base image selection', () => {
    beforeEach(() => {
      context.state.data.nextID = 100;
      // ID: 100
      mutations.addImage(context.state, {
        name: 'image',
        image: vtkImageData.newInstance(),
      });
      // ID: 101
      mutations.addDicom(context.state, {
        patientKey: 'patient1',
        studyKey: 'study1',
        seriesKey: 'series1',
      });
    });

    it('selectBaseImage selects a valid ID', async () => {
      await actions.selectBaseImage(context, 100);
      expect(context.commit).to.have.been.calledWith('setBaseImage', 100);
    });

    it('selectBaseImage rejects invalid IDs', async () => {
      await actions.selectBaseImage(context, 999);

      expect(context.commit).to.have.been.calledWith('setBaseImage', NO_SELECTION);
    });
  });
});
