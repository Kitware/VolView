import { useDicomMetaStore } from '@/src/store/dicom-web/dicom-meta-store';
import { useViewStore } from '@/src/store/views';
import {
  asErrorResult,
  asLoadableResult,
  asOkayResult,
} from '@/src/io/import/common';
import { useMessageStore } from '@/src/store/messages';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import {
  type PatientInfo,
  type StudyInfo,
  type VolumeInfo,
  useDICOMStore,
} from '@/src/store/datasets-dicom';
import { useDicomWebStore } from '@/src/store/dicom-web/dicom-web-store';

const patient: PatientInfo = {
  PatientID: 'patient-1',
  PatientName: 'Test Patient',
  PatientBirthDate: '',
  PatientSex: '',
};

const study: StudyInfo = {
  StudyID: 'study-1',
  StudyInstanceUID: 'study-uid',
  StudyDate: '',
  StudyTime: '',
  AccessionNumber: '',
  StudyDescription: '',
};

function volume(VolumeID: string, SeriesInstanceUID: string): VolumeInfo {
  return {
    NumberOfSlices: 1,
    VolumeID,
    Modality: 'CT',
    SeriesInstanceUID,
    SeriesNumber: '1',
    SeriesDescription: '',
    WindowLevel: '',
    WindowWidth: '',
    kind: 'volume',
  };
}

describe('DICOMweb loaded-series tracking', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('does not treat a different series with a shared UID prefix as loaded', () => {
    const dicomStore = useDICOMStore();
    const dicomWebStore = useDicomWebStore();

    dicomStore._updateDatabase(
      patient,
      study,
      volume('1.2.3.orientation', '1.2.3')
    );
    dicomStore._updateDatabase(
      patient,
      study,
      volume('1.2.30.orientation', '1.2.30')
    );
    dicomWebStore.volumes['1.2.3'] = {
      state: 'Done',
      loaded: 1,
      total: 1,
    };

    dicomStore.deleteVolume('1.2.3.orientation');

    expect(dicomWebStore.volumes['1.2.3']).toEqual({
      state: 'Remote',
      loaded: 0,
      total: 1,
    });
  });

  it('allows downloading a padded series UID after its final volume is deleted', () => {
    const store = useDICOMStore();
    const remote = useDicomWebStore();
    store._updateDatabase(patient, study, volume('first', '1.2.3 '));
    store._updateDatabase(patient, study, volume('second', '1.2.3\0'));
    remote.volumes['1.2.3'] = { state: 'Done', loaded: 2, total: 2 };
    store.deleteVolume('first');
    expect(remote.volumes['1.2.3'].state).toBe('Done');
    store.deleteVolume('second');
    expect(remote.volumes['1.2.3'].state).toBe('Remote');
  });
});

/** A remote series listed by the DICOMweb browser, and a spy on view selection. */
function remoteSeries() {
  useDicomMetaStore().importMeta({
    ...patient,
    ...study,
    ...volume('remote', 'series-uid'),
    SopInstanceUID: 'instance',
    StudyName: '',
    InstanceNumber: '1',
    Rows: '4',
    Columns: '4',
  });
  const select = vi.spyOn(useViewStore(), 'setDataForAllViews');
  return { select, store: useDicomWebStore() };
}

describe('unsupported DICOMweb downloads', () => {
  beforeEach(() => setActivePinia(createPinia()));
  it('keeps existing views and a retryable card when every result was skipped', async () => {
    const { select, store } = remoteSeries();
    const retrieve = vi.fn(async () => [new File([], 'rt.dcm')]);
    const importSources = async (
      sources: Parameters<typeof asOkayResult>[0][]
    ) => sources.map(asOkayResult);
    await store.downloadVolume('series-uid', retrieve, importSources);
    expect(store.volumes['series-uid'].state).toBe('Error');
    expect(select).not.toHaveBeenCalled();
    await store.downloadVolume('series-uid', retrieve, importSources);
    expect(retrieve).toHaveBeenCalledTimes(2);
  });
});

describe('partly failed DICOMweb downloads', () => {
  beforeEach(() => setActivePinia(createPinia()));
  it('shows the loaded volume and names every failed file in one notice', async () => {
    const { select, store } = remoteSeries();
    const retrieve = async () => [
      new File([], 'good.dcm'),
      new File([], 'bad.dcm'),
      new File([], 'worse.dcm'),
    ];
    const importSources = async ([good, bad, worse]: Parameters<
      typeof asOkayResult
    >[0][]) => [
      asLoadableResult('volume-1', good, 'image'),
      asErrorResult(new Error('bad.dcm is not DICOM'), bad),
      asErrorResult(new Error('worse.dcm is not DICOM'), worse),
    ];

    await store.downloadVolume('series-uid', retrieve, importSources);

    expect(store.volumes['series-uid'].state).toBe('Done');
    expect(select).toHaveBeenCalledWith('volume-1');
    expect(useMessageStore().messages).toEqual([
      expect.objectContaining({
        title: expect.stringMatching(/^2 of .* may be incomplete/),
        options: expect.objectContaining({
          details: 'bad.dcm is not DICOM\nworse.dcm is not DICOM',
        }),
      }),
    ]);
  });
});
