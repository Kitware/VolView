import { defineStore } from 'pinia';

import { DICOM_WEB_HOST } from '../config';
import { getAllSeriesWithThumbnail } from './dicomWeb';

/**
 * Fetch and list DICOM data with DICOMWeb
 */
export const useDicomWebStore = defineStore('dicom-web', {
  state: () => ({
    host: DICOM_WEB_HOST,
    message: '',
    dicoms: [] as any[],
  }),
  actions: {
    async fetchDicomList() {
      try {
        this.dicoms = await getAllSeriesWithThumbnail(this.host);
        if (this.dicoms.length === 0) {
          this.message = 'Found zero dicoms';
        } else {
          this.message = '';
        }
      } catch (e) {
        this.message = 'Failed to fetch DICOM list';
        this.dicoms = [];
      }
    },
  },
});
