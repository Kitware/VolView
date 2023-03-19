import { fetchFile } from '@/src/utils/fetch';
import { getURLBasename, partition } from '@/src/utils';
import {
  StateFile,
  DatasetType,
  Dataset,
  Manifest,
  RemoteDatasetFile,
} from './schema';
import {
  DatasetFile,
  isRemote,
  RemoteDatasetFileMeta,
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
    manifest: { datasets, remoteDatasetFiles },
  } = stateFile;

  dataIDs.forEach((id) => {
    const files = fileStore.getDatasetFiles(id);
    if (!files.length) {
      throw new Error(`No files for dataID: ${id}`);
    }

    const [remoteFiles, zipFiles] = partition(isRemote, files) as [
      Array<RemoteDatasetFileMeta>,
      Array<DatasetFile>
    ];

    remoteDatasetFiles[id] = remoteFiles.map(
      ({ url, path, file: { name } }) => ({
        url,
        path,
        name,
      })
    );

    const dataPath = `data/${id}/`;

    zipFiles.forEach(({ file }) => {
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

type RemoteFileCache = Record<string, FileEntry[] | Promise<FileEntry[]>>;

const getRemoteFile = () => {
  const cache: RemoteFileCache = {};

  return async ({
    url,
    path: remoteFilePath,
    name: remoteFileName,
  }: RemoteDatasetFile) => {
    if (!(url in cache)) {
      cache[url] = fetchFile(url, getURLBasename(url))
        .then((remoteFile) => retypeFile(remoteFile))
        .then((remoteFile) => extractArchivesRecursively([remoteFile]));
      cache[url] = await cache[url];
    }
    // ensure parallel remote file requests have resolved
    const remoteFiles = await cache[url];

    const file = remoteFiles.find(
      ({ path, file: { name } }) =>
        path === remoteFilePath && name === remoteFileName
    ); // ??? assumes unique file names in .zip URL?!

    if (!file)
      throw new Error(
        `Did not find matching file in remote file URL: ${url} : ${remoteFilePath} : ${remoteFileName}`
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
    const filesInStateFile = savedFiles.filter((entry) => entry.path === path);

    const remoteFiles = await Promise.all(
      manifest.remoteDatasetFiles[id].map(async (fileMeta) => {
        const remoteFile = await getFile(fileMeta);
        // const fileStore = useFileStore();
        // fileStore.addRemote(remoteFile, fileMeta.url);
        return remoteFile;
      })
    );
    return [...filesInStateFile, ...remoteFiles];
  };
};
