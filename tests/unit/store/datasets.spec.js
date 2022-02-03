import chai, { expect } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';

import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

import { mutations, makeActions } from '@/src/store/datasets';
import { initialState } from '@/src/store';
import { NO_SELECTION, DataTypes } from '@/src/constants';
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
      context.dispatch = sinon
        .stub()
        .withArgs('dicom/importFiles')
        .returns([
          {
            patientKey: 'patient1',
            studyKey: 'study1',
            seriesKey: 'series1',
          },
        ]);

      const files = [makeDicomFile('file1.dcm'), makeDicomFile('file2.dcm')];

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

      expect(context.dispatch).to.have.been.calledWith(
        'loadDicomFiles',
        dicomFiles
      );
      expect(context.dispatch).to.have.been.calledWith(
        'loadRegularFiles',
        regularFiles
      );
    });
  });

  describe('selectBaseImage', () => {
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

    it('selects a valid ID', async () => {
      await actions.selectBaseImage(context, 100);
      expect(context.commit).to.have.been.calledWith('setBaseImage', 100);
    });

    it('rejects invalid IDs', async () => {
      await actions.selectBaseImage(context, 999);

      expect(context.commit).to.have.been.calledWith(
        'setBaseImage',
        NO_SELECTION
      );
    });
  });

  describe('removeData', () => {
    it('action unselects the base image and deactivate widget', async () => {
      context.state.selectedBaseImage = 3;

      await actions.removeData(context, 3);

      expect(context.dispatch).to.have.been.calledWith(
        'deactivateActiveWidget'
      );
      expect(context.commit).to.have.been.calledWith(
        'setBaseImage',
        NO_SELECTION
      );
    });

    it('action removes annotation data', async () => {
      await actions.removeData(context, 1);

      const annotSpy = context.dispatch.withArgs('annotations/removeData', 1);
      const removeSpy = context.commit.withArgs('removeData', 1);
      expect(annotSpy).to.have.been.calledOnce;
      expect(removeSpy).to.have.been.calledOnce;
      expect(annotSpy).to.have.been.calledBefore(removeSpy);
    });

    it('action removes dicom data', async () => {
      context.state.data.index[1] = {
        type: DataTypes.Dicom,
        patientKey: 'abc',
        studyKey: 'abc',
        seriesKey: 'abc',
      };

      await actions.removeData(context, 1);

      expect(context.dispatch).to.have.been.calledWith(
        'dicom/removeData',
        'abc'
      );
    });

    it('action removes child associations before removing parent', async () => {
      // children of id=1: [id=2, id=3]
      context.state.dataAssoc.parentOf[2] = 1;
      context.state.dataAssoc.parentOf[3] = 1;
      context.state.dataAssoc.childrenOf[1] = [2, 3];

      await actions.removeData(context, 1);

      const del2Spy = context.dispatch.withArgs('removeData', 2);
      const del3Spy = context.dispatch.withArgs('removeData', 3);
      expect(del2Spy).to.have.been.calledOnce;
      expect(del3Spy).to.have.been.calledOnce;

      const removeSpy = context.commit.withArgs('removeData', 1);
      expect(removeSpy).to.have.been.calledAfter(del2Spy);
      expect(removeSpy).to.have.been.calledAfter(del3Spy);
    });

    describe('mutations.removeData', () => {
      const seriesKey = 'abc';
      let state;

      beforeEach(() => {
        state = context.state;
        state.data.index = {
          1: { type: DataTypes.Image },
          2: { type: DataTypes.Labelmap },
          3: { type: DataTypes.Model },
          4: {
            type: DataTypes.Dicom,
            seriesKey,
          },
        };
        state.data.vtkCache = {
          1: {},
          2: {},
          3: {},
          4: {},
        };
        state.data.imageIDs = [1];
        state.data.labelmapIDs = [2];
        state.data.modelIDs = [3];
        state.data.dicomIDs = [4];
        state.dicomSeriesToID[seriesKey] = 4;
        state.dataAssoc.parentOf[2] = 1;
        state.dataAssoc.parentOf[3] = 1;
        state.dataAssoc.childrenOf[1] = [2, 3];
      });

      [
        ['images', 'imageIDs', 1],
        ['labelmaps', 'labelmapIDs', 2],
        ['models', 'modelIDs', 3],
        ['dicom', 'dicomIDs', 4],
      ].forEach(([name, idList, id]) => {
        it(`removes ${name}`, () => {
          mutations.removeData(state, id);
          expect(state.data.index).to.not.have.property(id);
          expect(state.data.vtkCache).to.not.have.property(id);
          expect(state.data[idList]).to.not.contain(id);
        });
      });

      it('removes parent associations', () => {
        mutations.removeData(state, 2);
        expect(state.dataAssoc.parentOf).to.not.have.property(2);
        expect(state.dataAssoc.childrenOf[1])
          .to.have.length(1)
          .and.to.contain(3);
      });

      it('removes child associations', () => {
        mutations.removeData(state, 1);
        expect(state.dataAssoc.childrenOf).to.not.have.property(1);
      });
    });
  });

  describe('Data associations', () => {
    it('associateData associates a child with a parent', () => {
      const { state } = context;

      mutations.associateData(state, {
        parentID: 1,
        childID: 2,
      });

      const { parentOf, childrenOf } = state.dataAssoc;
      expect(parentOf[2]).to.equal(1);
      expect(childrenOf[1]).to.have.length(1);
      expect(childrenOf[1][0]).to.equal(2);
    });
  });
});
