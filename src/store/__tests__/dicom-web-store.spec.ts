import { useDicomMetaStore } from '@/src/store/dicom-web/dicom-meta-store';
import { useViewStore } from '@/src/store/views';
import { asOkayResult } from '@/src/io/import/common';
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
});

describe('unsupported DICOMweb downloads', () => {
  beforeEach(() => setActivePinia(createPinia()));
  it('keeps existing views and a retryable card when every result was skipped', async () => {
    const remote = useDicomMetaStore();
    remote.importMeta({
      ...patient,
      ...study,
      ...volume('remote', 'series-uid'),
      SopInstanceUID: 'instance',
      StudyName: '',
      InstanceNumber: '1',
      Rows: '4',
      Columns: '4',
    });
    const views = useViewStore();
    const select = vi.spyOn(views, 'setDataForAllViews');
    const store = useDicomWebStore();
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
