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
  const { fileSrc, uriSrc, chunkSrc } = dataSource;
  // existence of a chunkSrc means that the stream doesn't need to be downloaded.
  if (fileSrc || chunkSrc || !uriSrc?.fetcher) {
    return Skip;
  }

  const { fetcher } = uriSrc;
  await fetcher.connect();

  try {
    const blob = await fetcher.blob();
    const file = new File([blob], uriSrc.name, {
      type: uriSrc.mime,
    });

    return asIntermediateResult([
      {
        ...dataSource,
        fileSrc: {
          file,
          fileType: file.type,
        },
      },
    ]);
  } catch (err) {
    throw new Error(
      `Could not download stream associated with URL ${uriSrc.uri}`,
      {
        cause: ensureError(err),
      }
    );
  }
};

export default downloadStream;
