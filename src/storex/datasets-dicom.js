import { defineStore } from 'pinia';

export const useDICOMStore = defineStore('dicom', {
  actions: {
    importFiles(files) {
      console.log('dicom import files', files);
    },
  },
});
