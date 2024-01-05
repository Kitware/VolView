import { ImportHandler } from '@/src/io/import/common';
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
const downloadStream: ImportHandler = async (dataSource, { execute, done }) => {
  const { fileSrc, uriSrc } = dataSource;
  if (fileSrc || !uriSrc?.fetcher) {
    return dataSource;
  }

  const { fetcher } = uriSrc;
  await fetcher.connect();

  try {
    const blob = await fetcher.blob();
    const file = new File([blob], uriSrc.name, {
      type: uriSrc.mime,
    });

    execute({
      ...dataSource,
      fileSrc: {
        file,
        fileType: file.type,
      },
    });
    return done();
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
