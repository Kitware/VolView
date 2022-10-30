import { set } from '@vue/composition-api';
import { defineStore } from 'pinia';
import {
  convertSuccessResultToDataSelection,
  useDatasetStore,
} from '../store/datasets';

import { PatientInfo } from '../store/datasets-dicom';
import { useMessageStore } from '../store/messages';
import { useDicomMetaStore } from './dicom-meta.store';
import {
  searchForStudies,
  fetchSeries,
  FetchSeriesOptions,
  fetchInstanceThumbnail,
  retrieveStudyMetadata,
} from './dicomWeb';

export enum ProgressState {
  NotPending,
  Pending,
  Error,
  Done,
}

interface VolumeProgress {
  state: ProgressState;
  progress: number;
}

interface Progress {
  [name: string]: VolumeProgress;
}

export const isDownloadable = (progress?: VolumeProgress) =>
  !progress ||
  [ProgressState.Pending, ProgressState.Done].every(
    (state) => state !== progress.state
  );

export const DICOM_WEB_CONFIGURED =
  process.env.VUE_APP_DICOM_WEB_URL !== undefined;

async function getAllPatients(host: string): Promise<PatientInfo[]> {
  const instances = await searchForStudies(host);
  const dicoms = useDicomMetaStore();
  instances.forEach((instance) => dicoms.importMeta(instance));
  return Object.values(dicoms.patientInfo);
}

/**
 * Collect DICOM data from DICOMWeb
 */
export const useDicomWebStore = defineStore('dicom-web', {
  state: () => ({
    host: process.env.VUE_APP_DICOM_WEB_URL as string,
    isSetup: false,
    message: '',
    patients: [] as PatientInfo[],
    volumes: {} as Progress,
  }),
  actions: {
    async fetchDicomList() {
      this.patients = [];
      this.message = '';
      try {
        this.patients = await getAllPatients(this.host);

        if (this.patients.length === 0) {
          this.message = 'Found zero dicoms';
        }
      } catch (e) {
        this.message = 'Failed to fetch DICOM list';
        console.error(e);
      }
    },

    async fetchVolumeThumbnail(volumeKey: string) {
      const dicoms = useDicomMetaStore();
      const volumeInfo = dicoms.volumeInfo[volumeKey];
      const middleSlice = Math.floor(volumeInfo.NumberOfSlices / 2);
      const middleInstance = dicoms.volumeInstances[volumeKey]
        .map((instanceKey) => dicoms.instanceInfo[instanceKey])
        .sort(
          ({ InstanceNumber: a }, { InstanceNumber: b }) =>
            Number(a) - Number(b)
        )[middleSlice];

      const studyKey = dicoms.volumeStudy[volumeKey];
      const studyInfo = dicoms.studyInfo[studyKey];
      const instance = {
        studyInstanceUID: studyInfo.StudyInstanceUID,
        seriesInstanceUID: volumeInfo.SeriesInstanceUID,
        sopInstanceUID: middleInstance.SopInstanceUID,
      };
      return fetchInstanceThumbnail(this.host, instance);
    },

    async fetchSeries(seriesInfo: FetchSeriesOptions): Promise<File[]> {
      return fetchSeries(this.host, seriesInfo);
    },

    async fetchPatientMeta(patientKey: string) {
      const dicoms = useDicomMetaStore();
      const studies = await Promise.all(
        dicoms.patientStudies[patientKey]
          .map((studyKey) => dicoms.studyInfo[studyKey])
          .map(({ StudyInstanceUID }) =>
            retrieveStudyMetadata(this.host, {
              studyInstanceUID: StudyInstanceUID,
            })
          )
      );
      studies.flat().forEach((instance) => dicoms.importMeta(instance));
    },

    async downloadVolume(volumeKey: string) {
      const datasets = useDatasetStore();
      const dicoms = useDicomMetaStore();

      if (!isDownloadable(this.volumes[volumeKey])) return;

      set(this.volumes, volumeKey, {
        ...this.volumes[volumeKey],
        state: ProgressState.Pending,
        progress: 0,
      });

      const { SeriesInstanceUID: seriesInstanceUID } =
        dicoms.volumeInfo[volumeKey];
      const studyKey = dicoms.volumeStudy[volumeKey];
      const { StudyInstanceUID: studyInstanceUID } = dicoms.studyInfo[studyKey];
      const seriesInfo = { studyInstanceUID, seriesInstanceUID };

      try {
        const files = await this.fetchSeries(seriesInfo);
        if (files) {
          const [loadResult] = await datasets.loadFiles(files);
          if (loadResult?.loaded) {
            const selection = convertSuccessResultToDataSelection(loadResult);
            datasets.setPrimarySelection(selection);
          } else {
            throw new Error('Failed to load DICOM.');
          }
        } else {
          throw new Error('Fetch came back falsy.');
        }
      } catch (error) {
        const messageStore = useMessageStore();
        messageStore.addError('Failed to load DICOM', error as Error);
      }
    },
  },
});
