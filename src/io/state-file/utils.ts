import { Awaitable } from '@vueuse/core';
import { fetchFile } from '@/src/utils/fetch';
import { partition } from '@/src/utils';
import {
  StateFile,
  DatasetType,
  Dataset,
  Manifest,
  RemoteFile,
} from './schema';
import {
  DatasetFile,
  isRemote,
  makeRemote,
  RemoteDatasetFile,
  useFileStore,
} from '../../store/datasets-files';
import { FileEntry } from '../types';
import { extractArchivesRecursively, retypeFile } from '../io';
import { normalize as pathNormalize } from '../../utils/path';

export async function serializeData(
  stateFile: StateFile,
  dataIDs: string[],
  dataType: DatasetType
) {
  const fileStore = useFileStore();
  const { zip } = stateFile;
  const {
    manifest: { datasets, remoteFiles },
  } = stateFile;

  dataIDs.forEach((id) => {
    const files = fileStore.getDatasetFiles(id);
    if (!files.length) {
      throw new Error(`No files for dataID: ${id}`);
    }

    const [remotes, toZip] = partition(isRemote, files) as [
      Array<RemoteDatasetFile>,
      Array<DatasetFile>
    ];

    remoteFiles[id] = remotes.map(({ file: { name }, ...rest }) => ({
      name,
      ...rest,
    }));

    const dataPath = `data/${id}/`;

    toZip.forEach(({ file }) => {
      const filePath = `${dataPath}/${file.name}`;
      zip.file(filePath, file);
    });

    datasets.push({
      id,
      path: dataPath,
      type: dataType,
    });
  });
}

type RemoteFileCache = Record<string, Awaitable<DatasetFile[]>>;

const getRemoteFile = () => {
  // url to DatasetFiles
  const cache: RemoteFileCache = {};

  return async ({
    url,
    remoteFilename,
    archivePath,
    name: savedFilename,
  }: RemoteFile) => {
    // First time seeing URL?
    if (!(url in cache)) {
      // Fetch, extract, store Files in shared cache
      cache[url] = fetchFile(url, remoteFilename)
        .then(retypeFile)
        .then((remoteFile) =>
          extractArchivesRecursively([makeRemote(url, remoteFile)])
        );
    }
    // Ensure parallel remote file requests for same URL have resolved.
    const remoteFiles = await cache[url];

    const savedArchivePath = pathNormalize(archivePath ?? '');
    const file = remoteFiles.find(
      (remote) =>
        remote.file.name === savedFilename &&
        (!('archivePath' in remote) ||
          pathNormalize(remote.archivePath) === savedArchivePath)
    );

    if (!file)
      throw new Error(
        `Did not find matching file in remote file URL: ${url} : ${savedArchivePath} : ${savedFilename}`
      );

    return file;
  };
};

export const deserializeDatasetFiles = (
  manifest: Manifest,
  savedFiles: FileEntry[]
) => {
  const getFile = getRemoteFile();

  return async ({ id, path }: Dataset) => {
    const filesInStateFile = savedFiles.filter(
      ({ archivePath }) => archivePath === path
    );

    const remoteFiles = await Promise.all(
      manifest.remoteFiles[id].map(getFile)
    );
    return [...filesInStateFile, ...remoteFiles];
  };
};
