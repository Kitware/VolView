import { defineStore } from 'pinia';
import { pluck } from '../utils';

export type DatasetPath = string & { __type: 'DatasetPath' };
export type DatasetUrl = string & { __type: 'DatasetUrl' };
export type LocalDatasetFile = { file: File };
export type ZipDatasetFile = LocalDatasetFile & { archivePath: DatasetPath };
export type RemoteDatasetFile = LocalDatasetFile & {
  url: DatasetUrl;
  remoteFilename: string;
};
export type DatasetFile =
  | LocalDatasetFile
  | ZipDatasetFile
  | RemoteDatasetFile
  | (ZipDatasetFile & RemoteDatasetFile);

export const makeLocal = (file: File) => ({
  file,
});

export const makeRemote = (
  url: DatasetUrl | string,
  file: File | DatasetFile
) => {
  const isFile = file instanceof File;
  return {
    url: url as DatasetUrl,
    remoteFilename: isFile ? file.name : file.file.name,
    ...(isFile ? { file } : file),
  };
};

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
    // Returns [DatasetFile] used to build a dataID
    getDatasetFiles: (state) => (dataID: string) =>
      state.byDataID[dataID] ?? [],

    // Returns [File] used to build a dataID
    getFiles: (state) => (dataID: string) =>
      (state.byDataID[dataID] ?? []).map(pluck('file')),
  },

  actions: {
    remove(dataID: string) {
      if (dataID in this.byDataID) {
        delete this.byDataID[dataID];
      }
    },

    add(dataID: string, files: DatasetFile[]) {
      this.byDataID[dataID] = files;
    },
  },
});
