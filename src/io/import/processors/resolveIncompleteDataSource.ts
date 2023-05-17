import Pipeline from '@/src/core/pipeline';
import { ImportHandler } from '@/src/io/import/common';
import doneWithDataSource from '@/src/io/import/processors/doneWithDataSource';
import downloadUrl from '@/src/io/import/processors/downloadUrl';
import extractArchiveTarget from '@/src/io/import/processors/extractArchiveTarget';
import updateFileMimeType from '@/src/io/import/processors/updateFileMimeType';
import { ensureError } from '@/src/utils';

/**
 * Resolves a parent that is a UriSource.
 *
 * The input data source's parent into { fileSrc, parent: { uriSrc }}
 * @param dataSource
 * @param param1
 * @returns
 */
const resolveParentUri: ImportHandler = async (dataSource, { extra }) => {
  const { parent } = dataSource;
  if (parent?.uriSrc) {
    const pipeline = new Pipeline([
      updateFileMimeType,
      downloadUrl,
      doneWithDataSource,
    ]);
    const result = await pipeline.execute(parent, extra);
    if (!result.ok) {
      throw new Error('Failed to resolve data source with URI', {
        cause: ensureError(result.errors[0].cause),
      });
    }

    // replace the parent with the result data source.
    return {
      ...dataSource,
      parent: result.data[0].dataSource,
    };
  }
  return dataSource;
};

/**
 * Resolves an incomplete archive member.
 *
 * Transforms the input data source by adding a FileSource.
 * @param dataSource
 * @param param1
 */
const resolveArchiveMember: ImportHandler = async (dataSource, { extra }) => {
  if (dataSource.archiveSrc) {
    const pipeline = new Pipeline([
      updateFileMimeType,
      extractArchiveTarget,
      doneWithDataSource,
    ]);
    const result = await pipeline.execute(dataSource, extra);
    if (!result.ok) {
      throw new Error('Failed to resolve archive member', {
        cause: ensureError(result.errors[0].cause),
      });
    }

    // extractArchiveTarget returns the fully resolved data source.
    return result.data[0].dataSource;
  }
  return dataSource;
};

/**
 * Resolves an incomplete data source.
 *
 * Should be used after resolveParent in the same pipeline.
 *
 * There are two general kinds of unresolved data sources:
 * 1. URI src not downloaded
 * 2. archive member not extracted
 * @param dataSource
 * @returns
 */
const resolveIncompleteDataSource: ImportHandler = async (
  dataSource,
  { extra }
) => {
  // if fileSrc already exists, continue.
  if (dataSource.fileSrc) {
    return dataSource;
  }

  const { parent } = dataSource;
  if (!parent) {
    return dataSource;
  }

  const pipeline = new Pipeline([
    resolveParentUri,
    resolveArchiveMember,
    doneWithDataSource,
  ]);
  const result = await pipeline.execute(dataSource, extra);
  if (!result.ok) {
    throw new Error('Failed to resolve data source', {
      cause: ensureError(result.errors[0].cause),
    });
  }

  return result.data[0].dataSource;
};

export default resolveIncompleteDataSource;
