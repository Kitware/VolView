import {
  ArchiveContents,
  ImportHandler,
  isArchive,
} from '@/src/io/import/common';
import { extractFilesFromZip } from '@/src/io/zip';
import { normalize as normalizePath } from '@/src/utils/path';

const cacheArchiveContents: ImportHandler = async (
  dataSource,
  { extra, done }
) => {
  const { fileSrc } = dataSource;
  if (fileSrc && isArchive(dataSource) && extra?.archiveCache) {
    const archiveFile = fileSrc.file;
    const contentsPromise = extra.archiveCache.has(archiveFile)
      ? extra.archiveCache.get(archiveFile)!
      : extractFilesFromZip(archiveFile).then((files) => {
          return files.reduce((mapping, fileEntry) => {
            const fullPath = normalizePath(
              `${fileEntry.archivePath}/${fileEntry.file.name}`
            );
            return Object.assign(mapping, {
              [fullPath]: fileEntry.file,
            });
          }, {} as ArchiveContents);
        });

    extra.archiveCache.set(archiveFile, contentsPromise);
    return done({ dataSource });
  }
  return dataSource;
};

export default cacheArchiveContents;
