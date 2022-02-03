import chai, { expect } from 'chai';
import sinon from 'sinon';
import chaiAsPromised from 'chai-as-promised';
import sinonChai from 'sinon-chai';

import vtkITKHelper from '@kitware/vtk.js/Common/DataModel/ITKHelper';

import dicom, { imageCacheMultiKey } from '@/src/store/dicom';
import DicomIO from '@/src/io/dicom';

chai.use(chaiAsPromised);
chai.use(sinonChai);

const SAMPLE_DATA = [
  {
    uid: '1.2.3.4',
    info: {
      PatientName: 'anon',
      PatientID: 'none',
      PatientBirthDate: ' ',
      PatientSex: 'O ',
      StudyInstanceUID: '2.4.2.4',
      StudyID: 's1',
      SeriesInstanceUID: '1.2.3.4',
      SeriesDescription: 'ser1',
      NumberOfSlices: 15,
      ITKGDCMSeriesUID: '1.2.3.4',
    },
  },
  {
    uid: '2.3.4.5',
    info: {
      PatientName: '',
      PatientID: '',
      PatientBirthDate: ' ',
      PatientSex: 'O ',
      StudyInstanceUID: '1.1.1.1',
      StudyID: 's2',
      SeriesInstanceUID: '2.3.4.5',
      SeriesDescription: 'ser2',
      NumberOfSlices: 10,
      ITKGDCMSeriesUID: '2.3.4.5',
    },
  },
];

function dependencies() {
  const dicomIO = new DicomIO();
  return { dicomIO };
}

describe('DICOM module', () => {
  let deps;
  let mod;
  let context;

  beforeEach(() => {
    deps = dependencies();
    mod = dicom(deps);
    context = {
      state: mod.state,
      commit: sinon.spy(),
      dispatch: sinon.spy(),
    };

    // fake state
    SAMPLE_DATA.forEach((d) => {
      context.state.seriesIndex[d.uid] = { ...d.info };
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('importFiles', () => {
    it('should import a list of dicom objects', async () => {
      const data = SAMPLE_DATA.reduce(
        (obj, sample) => ({ ...obj, [sample.uid]: sample.info }),
        {}
      );
      sinon.stub(deps.dicomIO, 'importFiles').returns(data);

      // fake non-empty files
      const updatedKeys = await mod.actions.importFiles(context, [1, 2]);

      expect(updatedKeys.length).to.equal(2);
      expect(updatedKeys[0]).to.have.property('patientKey');
      expect(updatedKeys[0]).to.have.property('studyKey');
      expect(updatedKeys[0]).to.have.property('seriesKey');
    });

    it('addPatient should not clobber existing patient', () => {
      mod.mutations.addPatient(context.state, {
        patientKey: 'PKEY',
        patient: { id: 1 },
      });
      mod.mutations.addPatient(context.state, {
        patientKey: 'PKEY',
        patient: { id: 2 },
      });

      expect(context.state.patientIndex).to.have.property('PKEY');
      expect(context.state.patientIndex.PKEY.id).to.equal(1);
    });

    it('addStudy should not clobber existing study', () => {
      mod.mutations.addStudy(context.state, {
        studyKey: 'STKEY',
        study: { id: 1 },
        patientID: 1,
      });
      mod.mutations.addStudy(context.state, {
        studyKey: 'STKEY',
        study: { id: 2 },
        patientID: 1,
      });
      expect(context.state.studyIndex).to.have.property('STKEY');
      expect(context.state.studyIndex.STKEY.id).to.equal(1);
      expect(context.state.patientStudies)
        .to.have.property(1)
        .that.has.lengthOf(1);
    });

    it('addSeries should not clobber existing series', () => {
      mod.mutations.addSeries(context.state, {
        seriesKey: 'SKEY',
        series: { id: 1 },
        studyUID: 1,
      });
      mod.mutations.addSeries(context.state, {
        seriesKey: 'SKEY',
        series: { id: 2 },
        studyUID: 1,
      });
      expect(context.state.seriesIndex).to.have.property('SKEY');
      expect(context.state.seriesIndex.SKEY.id).to.equal(1);
      expect(context.state.studySeries)
        .to.have.property(1)
        .that.has.lengthOf(1);
    });
  });

  describe('Series images', () => {
    it('getSeriesImage fetches a series slice', async () => {
      const itkSliceImage = { data: 1 }; // dummy image obj
      const getSeriesImageStub = sinon
        .stub(deps.dicomIO, 'getSeriesImage')
        .returns(itkSliceImage);

      const result = await mod.actions.getSeriesImage(context, {
        seriesKey: '1.2.3.4',
        slice: 5,
        asThumbnail: true,
      });
      expect(result).to.deep.equal(itkSliceImage);
      expect(getSeriesImageStub).to.have.been.calledWith('1.2.3.4', 5);
      expect(context.commit).to.have.been.calledWith('cacheImageSlice', {
        seriesKey: '1.2.3.4',
        offset: 5,
        image: itkSliceImage,
        asThumbnail: true,
      });
    });

    it('getSeriesImage rejects invalid series', async () => {
      // no await so we can test promise rejection
      const result = mod.actions.getSeriesImage(context, {
        seriesKey: 'INVALID',
        slice: 5,
        asThumbnail: true,
      });

      expect(result).to.eventually.be.rejectedWith(Error);
    });

    it('getSeriesImage rejects out of bounds slice', async () => {
      const result = mod.actions.getSeriesImage(context, {
        seriesKey: '2.3.4.5',
        slice: 100,
        asThumbnail: true,
      });

      expect(result).to.eventually.be.rejectedWith(Error);
    });

    it('cacheImageSlice should cache an image', () => {
      const itkSliceImage = { data: 1 }; // dummy image obj

      mod.mutations.cacheImageSlice(context.state, {
        seriesKey: '1.2.3.4',
        offset: 5,
        asThumbnail: false,
        image: itkSliceImage,
      });
      expect(context.state.imageCache)
        .to.have.property('1.2.3.4')
        .that.has.property(imageCacheMultiKey(5, false));
    });
  });

  describe('Series volume', () => {
    let itkImageVolume;

    beforeEach(() => {
      itkImageVolume = { data: 1 }; // dummy image obj
    });

    it('buildVolume should return an itkImage volume', async () => {
      const buildSeriesVolumeStub = sinon
        .stub(deps.dicomIO, 'buildSeriesVolume')
        .returns(itkImageVolume);

      const dummyVtkImage = { vtkClass: 'vtkImageData' };
      sinon.stub(vtkITKHelper, 'convertItkToVtkImage').returns(dummyVtkImage);

      const seriesKey = '1.2.3.4';
      const result = await mod.actions.buildSeriesVolume(context, seriesKey);
      expect(buildSeriesVolumeStub).to.have.been.calledWith(seriesKey);
      expect(result).to.deep.equal(dummyVtkImage);
    });

    it('buildVolume should error on invalid series key', () => {
      const seriesKey = 'INVALID';
      const result = mod.actions.buildSeriesVolume(context, seriesKey);
      expect(result).to.eventually.be.rejectedWith(Error);
    });

    describe('Volume cache', () => {
      beforeEach(() => {
        mod.mutations.cacheSeriesVolume(context.state, {
          seriesKey: '1.2.3.4',
          image: { some: 'vtkImage' },
        });
      });

      it('cacheSeriesVolume should save a volume', () => {
        expect(context.state.volumeCache).to.have.property('1.2.3.4');
      });

      it('importing files into existing series should delete volume', async () => {
        const seriesKey = '1.2.3.4';
        context.state.seriesIndex[seriesKey] = {};
        sinon.stub(deps.dicomIO, 'importFiles').returns({
          [seriesKey]: {
            ...SAMPLE_DATA[0].info,
          },
        });

        await mod.actions.importFiles(context, [1]);
        expect(context.commit).to.have.been.calledWith(
          'deleteSeriesVolume',
          seriesKey
        );
      });

      it('deleteSeriesVolume should remove a volume', () => {
        mod.mutations.deleteSeriesVolume(context.state, '1.2.3.4');
        expect(context.state.volumeCache).to.not.have.property('1.2.3.4');
      });
    });
  });
});
