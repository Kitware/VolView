import chai, { expect } from 'chai';
import sinon from 'sinon';
import chaiAsPromised from 'chai-as-promised';
import sinonChai from 'sinon-chai';

import vtkITKHelper from 'vtk.js/Sources/Common/DataModel/ITKHelper';

import dicom, { imageCacheMultiKey } from '@/src/store/dicom';
import DicomIO from '@/src/io/dicom';

import { vuexFakes } from '@/tests/testUtils';

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
  let state;

  beforeEach(() => {
    deps = dependencies();
    mod = dicom(deps);
    state = mod.state;

    // fake state
    SAMPLE_DATA.forEach((d) => {
      state.seriesIndex[d.uid] = { ...d.info };
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('importFiles', () => {
    it('should import a list of dicom objects', async () => {
      const data = SAMPLE_DATA.reduce(
        (obj, sample) => ({ ...obj, [sample.uid]: sample.info }),
        {},
      );
      sinon.stub(deps.dicomIO, 'importFiles').returns(data);

      const fakes = vuexFakes();
      // fake non-empty files
      const updatedKeys = await mod.actions.importFiles(
        { ...fakes, state },
        [1, 2, 3],
      );
      expect(updatedKeys.length).to.equal(2);
      expect(updatedKeys[0]).to.have.property('patientKey');
      expect(updatedKeys[0]).to.have.property('studyKey');
      expect(updatedKeys[0]).to.have.property('seriesKey');
    });

    it('add* should not clobber existing patient, study, series keys', () => {
      mod.mutations.addPatient(state, { patientKey: 'PKEY', patient: { id: 1 } });
      mod.mutations.addPatient(state, { patientKey: 'PKEY', patient: { id: 2 } });
      expect(state.patientIndex).to.have.property('PKEY');
      expect(state.patientIndex.PKEY.id).to.equal(1);

      mod.mutations.addStudy(state, {
        studyKey: 'STKEY',
        study: { id: 1 },
        patientID: 1,
      });
      mod.mutations.addStudy(state, {
        studyKey: 'STKEY',
        study: { id: 2 },
        patientID: 1,
      });
      expect(state.studyIndex).to.have.property('STKEY');
      expect(state.studyIndex.STKEY.id).to.equal(1);
      expect(state.patientStudies)
        .to.have.property(1)
        .that.has.lengthOf(1);

      mod.mutations.addSeries(state, {
        seriesKey: 'SKEY',
        series: { id: 1 },
        studyUID: 1,
      });
      mod.mutations.addSeries(state, {
        seriesKey: 'SKEY',
        series: { id: 2 },
        studyUID: 1,
      });
      expect(state.seriesIndex).to.have.property('SKEY');
      expect(state.seriesIndex.SKEY.id).to.equal(1);
      expect(state.studySeries)
        .to.have.property(1)
        .that.has.lengthOf(1);
    });
  });

  describe('Series images', () => {
    it('getSeriesImage fetches a series slice', async () => {
      const itkSliceImage = { data: 1 }; // dummy image obj

      // fake state
      SAMPLE_DATA.forEach((d) => {
        state.seriesIndex[d.uid] = { ...d.info };
      });

      const getSeriesImageStub = sinon
        .stub(deps.dicomIO, 'getSeriesImage')
        .returns(itkSliceImage);

      let result;
      let fakes;

      fakes = vuexFakes();
      result = await mod.actions.getSeriesImage({ ...fakes, state }, {
        seriesKey: '1.2.3.4',
        slice: 5,
        asThumbnail: true,
      });
      expect(result).to.deep.equal(itkSliceImage);
      expect(getSeriesImageStub).to.have.been.calledWith('1.2.3.4', 5);
      expect(fakes.commit).to.have.been.calledWith('cacheImageSlice', {
        seriesKey: '1.2.3.4',
        offset: 5,
        image: itkSliceImage,
        asThumbnail: true,
      });

      // TODO test skipping getSeriesImage stub when image is cached.

      // invalid series key
      // no await so we can test promise rejection
      fakes = vuexFakes();
      result = mod.actions.getSeriesImage({ ...fakes, state }, {
        seriesKey: 'INVALID',
        slice: 5,
        asThumbnail: true,
      });
      expect(result).to.eventually.be.rejectedWith(Error);

      // out of bounds
      fakes = vuexFakes();
      result = mod.actions.getSeriesImage({ ...fakes, state }, {
        seriesKey: '2.3.4.5',
        slice: 100,
        asThumbnail: true,
      });
      expect(result).to.eventually.be.rejectedWith(Error);
    });

    it('cacheImageSlice should cache an image', () => {
      const itkSliceImage = { data: 1 }; // dummy image obj

      mod.mutations.cacheImageSlice(state, {
        seriesKey: '1.2.3.4',
        offset: 5,
        asThumbnail: false,
        image: itkSliceImage,
      });
      expect(state.imageCache)
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

      const fakes = vuexFakes();
      const seriesKey = '1.2.3.4';
      const result = await mod.actions.buildSeriesVolume({ ...fakes, state }, seriesKey);
      expect(buildSeriesVolumeStub).to.have.been.calledWith(seriesKey);
      expect(result).to.deep.equal(dummyVtkImage);
    });

    it('buildVolume should error on invalid series key', () => {
      const fakes = vuexFakes();
      const seriesKey = 'INVALID';
      const result = mod.actions.buildSeriesVolume({ ...fakes, state }, seriesKey);
      expect(result).to.eventually.be.rejectedWith(Error);
    });

    describe('Volume cache', () => {
      beforeEach(() => {
        mod.mutations.cacheSeriesVolume(state, {
          seriesKey: '1.2.3.4',
          image: { some: 'vtkImage' },
        });
      });

      it('cacheSeriesVolume should save a volume', () => {
        expect(state.volumeCache).to.have.property('1.2.3.4');
      });

      it('importing files into existing series should delete volume', async () => {
        const seriesKey = '1.2.3.4';
        state.seriesIndex[seriesKey] = {};
        sinon.stub(deps.dicomIO, 'importFiles').returns({
          [seriesKey]: {
            ...SAMPLE_DATA[0].info,
          },
        });

        const fakes = vuexFakes();
        await mod.actions.importFiles({ ...fakes, state }, [1]);
        expect(fakes.commit).to.have.been.calledWith('deleteSeriesVolume', seriesKey);
      });

      it('deleteSeriesVolume should remove a volume', () => {
        mod.mutations.deleteSeriesVolume(state, '1.2.3.4');
        expect(state.volumeCache).to.not.have.property('1.2.3.4');
      });
    });
  });
});
