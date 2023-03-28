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

    remoteFiles[id] = remotes
      .map((f) => ({ path: '', ...f })) // ensure path
      .map(({ url, remoteFilename, path, file: { name } }) => ({
        url,
        remoteFilename,
        path,
        name,
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

type RemoteFileCache = Record<string, DatasetFile[] | Promise<DatasetFile[]>>;

const getRemoteFile = () => {
  // url to DatasetFiles
  const cache: RemoteFileCache = {};

  return async ({
    url,
    remoteFilename,
    path: extractedFilePath,
    name: extractedFilename,
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

    const file = remoteFiles
      .map((f) => ({ path: '', ...f }))
      .find(
        ({ path, file: { name } }) =>
          path === extractedFilePath && name === extractedFilename
      );

    if (!file)
      throw new Error(
        `Did not find matching file in remote file URL: ${url} : ${extractedFilePath} : ${extractedFilename}`
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
