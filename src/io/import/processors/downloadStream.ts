import { Skip } from '@/src/utils/evaluateChain';
import { ImportHandler, asIntermediateResult } from '@/src/io/import/common';
import { ensureError } from '@/src/utils';

/**
 * Downloads a URL to a file DataSource.
 *
 * Input: { uriSrc }
 * Output: { fileSrc, uriSrc }
 *
 * Provides optional caching if the execution context provides a cache.
 * @param dataSource
 * @returns
 */
const downloadStream: ImportHandler = async (dataSource) => {
  if (dataSource.type !== 'uri') return Skip;
  if (!dataSource.fetcher) return Skip;

  const { fetcher } = dataSource;
  await fetcher.connect();

  try {
    const blob = await fetcher.blob();
    const file = new File([blob], dataSource.name, {
      type: dataSource.mime,
    });

    return asIntermediateResult([
      {
        type: 'file',
        file,
        fileType: file.type,
        parent: dataSource,
      },
    ]);
  } catch (err) {
    throw new Error(
      `Could not download stream associated with URL ${dataSource.uri}`,
      {
        cause: ensureError(err),
      }
    );
  }
};

export default downloadStream;
