import { defineStore } from 'pinia';
import { FileSource } from '@/src/io/import/dataSource';

interface State {
  byDataID: Record<string, FileSource[]>;
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
      (state.byDataID[dataID] ?? []).map((ds) => ds.file),
  },

  actions: {
    remove(dataID: string) {
      if (dataID in this.byDataID) {
        delete this.byDataID[dataID];
      }
    },

    add(dataID: string, files: FileSource[]) {
      this.byDataID[dataID] = files;
    },
  },
});
