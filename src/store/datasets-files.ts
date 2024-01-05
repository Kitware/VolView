import { defineStore } from 'pinia';
import { FileDataSource } from '@/src/io/import/dataSource';

interface State {
  byDataID: Record<string, FileDataSource[]>;
}

/**
 * Store the File objects associated with a given dataset.
 */
export const useFileStore = defineStore('files', {
  state: (): State => ({
    byDataID: {},
  }),

  getters: {
    // Returns DataSource[] used to build a dataID
    getDataSources: (state) => (dataID: string) => state.byDataID[dataID] ?? [],

    // Returns [File] used to build a dataID
    getFiles: (state) => (dataID: string) =>
      (state.byDataID[dataID] ?? []).map((ds) => ds.fileSrc.file),
  },

  actions: {
    remove(dataID: string) {
      if (dataID in this.byDataID) {
        delete this.byDataID[dataID];
      }
    },

    add(dataID: string, files: FileDataSource[]) {
      this.byDataID[dataID] = files;
    },
  },
});
