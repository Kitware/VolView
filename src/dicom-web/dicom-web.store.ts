import { defineStore } from 'pinia';

import { DICOM_WEB_HOST } from '../config';
import { PatientInfo } from '../store/datasets-dicom';
import { useDicomMetaStore } from './dicom-meta.store';
import {
  fetchAllInstances,
  fetchSeries,
  fetchSeriesThumbnail,
  FetchSeriesOptions,
} from './dicomWeb';

async function getAllPatients(host: string): Promise<PatientInfo[]> {
  const instances = await fetchAllInstances(host);
  const dicoms = useDicomMetaStore();
  instances.forEach((instance) => dicoms.importInstance(instance));
  return Object.values(dicoms.patientInfo);
}

/**
 * Fetch and list DICOM data with DICOMWeb
 */
export const useDicomWebStore = defineStore('dicom-web', {
  state: () => ({
    host: DICOM_WEB_HOST,
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

    async fetchSeriesThumbnail(seriesInfo: FetchSeriesOptions) {
      return fetchSeriesThumbnail(this.host, seriesInfo);
    },

    async fetchSeries(seriesInfo: FetchSeriesOptions): Promise<File[]> {
      return fetchSeries(this.host, seriesInfo);
    },
  },
});
