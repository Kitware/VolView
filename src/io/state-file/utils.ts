import { fetchFile } from '@/src/utils/fetch';
import { getURLBasename } from '@/src/utils';
import { StateFile, DataSetType } from './schema';
import { useFileStore } from '../../store/datasets-files';
import { FileEntry } from '../types';
import { extractArchivesRecursively, retypeFile } from '../io';

export type RemoteFileCache = Record<string, File[] | Promise<File[]>>;

const REMOTE_EXT = '.json-with-remote-url';

export async function serializeData(
  stateFile: StateFile,
  dataIDs: string[],
  dataType: DataSetType
) {
  const fileStore = useFileStore();
  const { zip } = stateFile;
  const {
    manifest: { dataSets },
  } = stateFile;

  dataIDs.forEach((id) => {
    const files = fileStore.getFiles(id);
    if (files === null) {
      throw new Error(`No files for dataID: ${id}`);
    }

    const dataPath = `data/${id}/`;
    dataSets.push({
      id,
      path: dataPath,
      type: dataType,
    });

    files.forEach((file: File) => {
      const filePath = `data/${id}/${file.name}`;
      // replace files from remote source with file with URL
      const url = fileStore.fileToRemote.get(file);
      const urlFile = new File([JSON.stringify({ url })], file.name, {
        type: 'application/json',
      });
      console.log(urlFile.type);
      if (url) zip.file(filePath + REMOTE_EXT, urlFile);
      else zip.file(filePath, file);
    });
  });
}

const getFile = async (
  cache: RemoteFileCache,
  url: string,
  fileName: string
) => {
  if (!(url in cache)) {
    // eslint-disable-next-line no-param-reassign
    cache[url] = fetchFile(url, getURLBasename(url))
      .then((remoteFile) => retypeFile(remoteFile))
      .then((remoteFile) => extractArchivesRecursively([remoteFile]))
      .then((fileEntries) => fileEntries.map(({ file }) => file));
    // eslint-disable-next-line no-param-reassign
    cache[url] = await cache[url];
  }

  // ensure parallel remote file requests have resolved
  const sansRemoteExtension = fileName.substring(
    0,
    fileName.length - REMOTE_EXT.length
  );
  const file = (await cache[url]).find(
    ({ name }) => name === sansRemoteExtension
  ); // assumes unique file names in .zip URL!
  if (!file)
    throw new Error('Did not find matching filename in remote file URL');

  return file;
};

export const makeDeserializeFiles = (savedFiles: FileEntry[]) => {
  const remoteFileCache: RemoteFileCache = {};

  const deserializeFiles = async (dataSetPath: string) => {
    const datasetFiles = await Promise.all(
      savedFiles
        .filter((entry) => entry.path === dataSetPath)
        .map((entry) => entry.file)
        .map(async (file) => {
          const isRemotePointer = file.name.endsWith(REMOTE_EXT);
          if (!isRemotePointer) return file;

          const { url } = JSON.parse(await file.text());
          const remoteFile = await getFile(remoteFileCache, url, file.name);
          const fileStore = useFileStore();
          fileStore.addRemote(remoteFile, url);
          return remoteFile;
        })
    );
    return datasetFiles;
  };

  return deserializeFiles;
};
