import { del, set } from '@vue/composition-api';
import { defineStore } from 'pinia';
import { pluck } from '../utils';

export type DatasetUrl = string & { __type: 'UrlString' };
export type LocalDatasetFile = { file: File };
export type ZipDatasetFile = LocalDatasetFile & { path: string };
export type RemoteDatasetFile = LocalDatasetFile & { url: DatasetUrl };
export type DatasetFile =
  | LocalDatasetFile
  | ZipDatasetFile
  | RemoteDatasetFile
  | (ZipDatasetFile & RemoteDatasetFile);

export const makeLocal = (file: File) => ({
  file,
});

export const makeZip =
  (path = '') =>
  (file: File) => ({
    file,
    path,
  });

export const makeRemote = (url: DatasetUrl | string) => (file: File) => ({
  file,
  url: url as DatasetUrl,
});

export const isRemote = (
  datasetFile: DatasetFile
): datasetFile is RemoteDatasetFile =>
  (datasetFile as RemoteDatasetFile).url !== undefined;

interface State {
  byDataID: Record<string, DatasetFile[]>;
}

/**
 * Store the File objects associated with a given dataset.
 */
export const useFileStore = defineStore('files', {
  state: (): State => ({
    byDataID: {},
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
        del(this.byDataID, dataID);
      }
    },

    add(dataID: string, files: DatasetFile[]) {
      set(this.byDataID, dataID, files);
    },
  },
});
