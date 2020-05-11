import { expect } from 'chai';
import sinon from 'sinon';

import dicom, { ANONYMOUS_PATIENT_ID } from '@/src/store/dicom';
import DicomIO from '@/src/io/dicom';
import { pick } from '../../../src/utils/common';

const SAMPLE_DATA = [
  {
    uid: '1.2.3.4',
    info: {
      PatientName: 'anon',
      PatientID: 'none',
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
      StudyInstanceUID: '1.1.1.1',
      StudyID: 's2',
      SeriesInstanceUID: '2.3.4.5',
      SeriesDescription: 'ser2',
    },
  },
];

function vuexFakes() {
  const dispatch = sinon.fake();
  const commit = sinon.fake();
  return { dispatch, commit };
}

function dependencies() {
  const dicomIO = new DicomIO();
  return { dicomIO };
}

describe('DICOM module actions', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('should import a list of dicom objects', async () => {
    const deps = dependencies();
    const mod = dicom(deps);

    sinon.stub(deps.dicomIO, 'importFiles').returns({});

    const fakes = vuexFakes();
    await mod.actions.importFiles(fakes, [/* empty files */]);

    const firstCommit = fakes.commit.args[0];
    expect(firstCommit[0]).to.equal('upsertSeries');
  });
});

describe('DICOM module mutations', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('should update the local dicom db with upsertSeries', () => {
    const mod = dicom();
    const { state } = mod;

    SAMPLE_DATA.forEach(({ uid, info }) => mod.mutations.upsertSeries(state, {
      seriesUID: uid,
      info,
    }));

    const pickPatientInfo = (info) => pick(info, [
      'PatientID',
      'PatientName',
      'PatientBirthDate',
      'PatientSex',
    ]);
    const pickStudyInfo = (info) => pick(info, ['StudyID']);
    const pickSeriesInfo = (info) => pick(info, ['SeriesDescription']);

    expect(state.patientIndex).to.deep.equal({
      [SAMPLE_DATA[0].info.PatientID]: {
        ...pickPatientInfo(SAMPLE_DATA[0].info),
      },
      [ANONYMOUS_PATIENT_ID]: {
        ...pickPatientInfo(SAMPLE_DATA[1].info),
      },
    });

    expect(state.studyIndex).to.deep.equal({
      [SAMPLE_DATA[0].info.StudyInstanceUID]: {
        ...pickStudyInfo(SAMPLE_DATA[0].info),
      },
      [SAMPLE_DATA[1].info.StudyInstanceUID]: {
        ...pickStudyInfo(SAMPLE_DATA[1].info),
      },
    });

    expect(state.seriesIndex).to.deep.equal({
      [SAMPLE_DATA[0].info.SeriesInstanceUID]: {
        ...pickSeriesInfo(SAMPLE_DATA[0].info),
      },
      [SAMPLE_DATA[1].info.SeriesInstanceUID]: {
        ...pickSeriesInfo(SAMPLE_DATA[1].info),
      },
    });
  });
});
