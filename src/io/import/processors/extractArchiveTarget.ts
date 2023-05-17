import {
  ArchiveCache,
  ArchiveContents,
  ImportHandler,
  isArchive,
} from '@/src/io/import/common';
import { extractFilesFromZip } from '@/src/io/zip';
import { Maybe } from '@/src/types';
import * as path from '@/src/utils/path';
import { Awaitable } from '@vueuse/core';

async function extractArchiveContents(archiveFile: File, cache?: ArchiveCache) {
  let contentsPromise: Maybe<Awaitable<ArchiveContents>> =
    cache?.get(archiveFile);
  if (contentsPromise) {
    return contentsPromise;
  }

  contentsPromise = extractFilesFromZip(archiveFile).then((files) => {
    return files.reduce((mapping, fileEntry) => {
      const fullPath = path.normalize(
        `${fileEntry.archivePath}/${fileEntry.file.name}`
      );
      return Object.assign(mapping, {
        [fullPath]: fileEntry.file,
      });
    }, {} as ArchiveContents);
  });

  if (cache) {
    cache.set(archiveFile, contentsPromise);
  }

  return contentsPromise;
}

/**
 * Extracts a single target file from an archive.
 *
 * If the fileSrc already exists, nothing is done. Otherwise, attempt to
 * extract the file from the parent archive.
 *
 * Input data source must be of the following form:
 * { archiveSrc, parent: DataSource with a fileSrc }
 * @param dataSource
 * @returns
 */
const extractArchiveTarget: ImportHandler = async (
  dataSource,
  { extra, execute, done }
) => {
  const { fileSrc, archiveSrc, parent } = dataSource;
  const { archiveCache } = extra ?? {};

  if (!fileSrc && archiveSrc && parent) {
    if (!parent?.fileSrc) {
      throw new Error(
        'Cannot extract an archive target with an unresolved parent'
      );
    }

    if (!isArchive(parent)) {
      throw new Error('Parent is not a supported archive file');
    }

    const archiveContents = await extractArchiveContents(
      parent.fileSrc.file,
      archiveCache
    );

    const targetName = path.normalize(archiveSrc.path);
    const targetFile = archiveContents[targetName];
    if (!targetFile) {
      throw new Error(`Failed to find archive member ${targetName}`);
    }

    execute({
      ...dataSource,
      fileSrc: {
        file: targetFile,
        fileType: '',
      },
    });
    return done();
  }

  return dataSource;
};

export default extractArchiveTarget;
