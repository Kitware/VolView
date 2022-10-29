import { defineStore } from 'pinia';

import { PatientInfo } from '../store/datasets-dicom';
import { useDicomMetaStore } from './dicom-meta.store';
import {
  searchForStudies,
  fetchSeries,
  FetchSeriesOptions,
  fetchInstanceThumbnail,
  retrieveStudyMetadata,
} from './dicomWeb';

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
    message: '',
    patients: [] as PatientInfo[],
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
  },
});
