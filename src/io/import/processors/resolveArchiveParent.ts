import Pipeline from '@/src/core/pipeline';
import { ImportHandler, isArchive } from '@/src/io/import/common';
import cacheArchiveContents from '@/src/io/import/processors/cacheArchiveContents';
import doneWithDataSource from '@/src/io/import/processors/doneWithDataSource';
import downloadUrl from '@/src/io/import/processors/downloadUrl';
import updateFileMimeType from '@/src/io/import/processors/updateFileMimeType';

/**
 * Resolves a data source's parent, ensuring it's an archive, and cache its contents.
 *
 * This relies on the pipeline to provide
 * @param dataSource
 * @returns
 */
const resolveArchiveParent: ImportHandler = async (dataSource, { extra }) => {
  const { fileSrc, archiveSrc, parent } = dataSource;
  if (!fileSrc && archiveSrc && parent) {
    const pipeline = new Pipeline([
      updateFileMimeType,
      downloadUrl,
      cacheArchiveContents,
      // handles the recursive case (nested archiveSrc)
      resolveArchiveParent,
      doneWithDataSource,
    ]);
    const result = await pipeline.execute(parent, extra);
    if (!result.ok) {
      throw result.errors[0].cause;
    }

    const resolvedParent = result.data[0].dataSource;
    if (!isArchive(resolvedParent)) {
      throw new Error('Resolved parent is not an archive');
    }

    return {
      ...dataSource,
      parent: resolvedParent,
    };
  }
  return dataSource;
};

export default resolveArchiveParent;
