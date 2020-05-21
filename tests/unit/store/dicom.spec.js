import { expect } from 'chai';
import sinon from 'sinon';

import dicom from '@/src/store/dicom';
import DicomIO from '@/src/io/dicom';

import { vuexFakes } from '@/tests/testUtils';

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
    },
  },
];

function dependencies() {
  const dicomIO = new DicomIO();
  return { dicomIO };
}

describe('DICOM module', () => {
  afterEach(() => {
    sinon.restore();
  });

  describe('importFiles', () => {
    it('should import a list of dicom objects', async () => {
      const deps = dependencies();
      const mod = dicom(deps);

      const data = SAMPLE_DATA.reduce(
        (obj, sample) => ({ ...obj, [sample.uid]: sample.info }),
        {},
      );
      sinon.stub(deps.dicomIO, 'importFiles').returns(data);

      const fakes = vuexFakes();
      // fake non-empty files
      const updatedKeys = await mod.actions.importFiles(fakes, [1, 2, 3]);
      expect(updatedKeys.length).to.equal(2);
      expect(updatedKeys[0]).to.have.property('patientKey');
      expect(updatedKeys[0]).to.have.property('studyKey');
      expect(updatedKeys[0]).to.have.property('seriesKey');
    });

    it('add* should not clobber existing patient, study, series keys', () => {
      const mod = dicom();
      const { state } = mod;
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
});
