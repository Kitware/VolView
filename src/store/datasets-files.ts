import { del, set } from '@vue/composition-api';
import { defineStore } from 'pinia';
import { DataSourceWithFile } from '@/src/io/import/dataSource';

interface State {
  byDataID: Record<string, DataSourceWithFile[]>;
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
        del(this.byDataID, dataID);
      }
    },

    add(dataID: string, files: DataSourceWithFile[]) {
      set(this.byDataID, dataID, files);
    },
  },
});
