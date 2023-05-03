import Pipeline from '@/src/core/pipeline';
import { ImportHandler } from '@/src/io/import/common';
import doneWithDataSource from '@/src/io/import/processors/doneWithDataSource';
import resolveArchiveParent from '@/src/io/import/processors/resolveArchiveParent';
import * as path from '@/src/utils/path';

/**
 * Extracts a single target file from an archive.
 *
 * If the fileSrc already exists, nothing is done. Otherwise, attempt to
 * extract the file from the parent archive.
 *
 * Input data source must be of the following form:
 * { archiveSrc, parent: DataSource }
 * @param dataSource
 * @returns
 */
const extractArchiveTarget: ImportHandler = async (dataSource, { extra }) => {
  const { fileSrc, archiveSrc, parent } = dataSource;
  if (extra?.archiveCache && !fileSrc && archiveSrc && parent) {
    // ensure parent is resolved
    const pipeline = new Pipeline([resolveArchiveParent, doneWithDataSource]);
    const results = await pipeline.execute(dataSource, extra);
    if (!results.ok) {
      throw results.errors[0].cause;
    }

    const resolvedSource = results.data[0].dataSource;
    const archiveFile = resolvedSource.parent?.fileSrc?.file;
    if (!archiveFile) {
      throw new Error('Failed to get archive file from parent');
    }

    const archiveContents = await extra.archiveCache.get(archiveFile);
    if (!archiveContents) {
      throw new Error(`Failed to find a cache for ${archiveFile.name}`);
    }

    const targetName = path.normalize(archiveSrc.path);
    const targetFile = archiveContents[targetName];
    if (!targetFile) {
      throw new Error(`Failed to find archive member ${targetName}`);
    }

    return {
      ...resolvedSource,
      fileSrc: {
        file: targetFile,
        fileType: '',
      },
    };
  }
  return dataSource;
};

export default extractArchiveTarget;
