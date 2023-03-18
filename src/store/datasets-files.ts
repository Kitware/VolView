import { del, set } from '@vue/composition-api';
import { defineStore } from 'pinia';
import { pluck } from '../utils';

export type DatasetUrl = string & { __type: 'UrlString' };
export type LocalDatasetFileMeta = { path: string; file: { name: string } };
export type RemoteDatasetFileMeta = LocalDatasetFileMeta & { url: DatasetUrl };
export type DatasetFileMeta = LocalDatasetFileMeta | RemoteDatasetFileMeta;

export type DatasetFile = DatasetFileMeta & {
  file: File;
};

export function isRemote(
  datasetFile: DatasetFileMeta
): datasetFile is RemoteDatasetFileMeta {
  // return (datasetFile as RemoteDatasetFileMeta).url !== undefined;
  return 'url' in datasetFile;
}

interface State {
  byDataID: Record<string, DatasetFile[]>;
  fileToRemote: Map<File, string>;
}

/**
 * Store the File objects associated with a given dataset.
 */
export const useFileStore = defineStore('files', {
  state: (): State => ({
    byDataID: {},
    fileToRemote: new Map(),
  }),

  getters: {
    getDatasetFiles: (state) => (dataID: string) =>
      state.byDataID[dataID] ?? [],

    getFiles: (state) => (dataID: string) =>
      (state.byDataID[dataID] ?? []).map(pluck('file')),
  },

  actions: {
    remove(dataID: string) {
      if (dataID in this.byDataID) {
        // this.byDataID[dataID].forEach((file) => this.fileToRemote.delete(file));
        del(this.byDataID, dataID);
      }
    },

    add(dataID: string, files: DatasetFile[]) {
      set(this.byDataID, dataID, files);
    },

    addRemote(file: File, url: string) {
      this.fileToRemote.set(file, url);
    },
  },
});
