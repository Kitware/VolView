import { ImportHandler } from '@/src/io/import/common';
import { ensureError } from '@/src/utils';

/**
 * Resolves a data source's parent.
 *
 * A data source is considered if it has a fileSrc or uriSrc.
 * @param dataSource
 * @returns
 */
const resolveParent: ImportHandler = async (dataSource, { execute }) => {
  const { parent } = dataSource;
  if (parent) {
    const result = await execute(parent);
    if (!result.ok) {
      throw new Error('Failed to resolve parent data source', {
        cause: ensureError(result.errors[0].cause),
      });
    }
    return {
      ...dataSource,
      parent: result.data[0].dataSource,
    };
  }
  return dataSource;
};

export default resolveParent;
