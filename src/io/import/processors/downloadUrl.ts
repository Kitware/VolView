import { canFetchUrl, fetchFile } from '@/src/utils/fetch';
import { ImportHandler } from '@/src/io/import/common';

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
const downloadUrl: ImportHandler = async (
  dataSource,
  { execute, done, extra }
) => {
  const { fileSrc, uriSrc } = dataSource;
  if (!fileSrc && uriSrc && canFetchUrl(uriSrc.uri)) {
    try {
      const file = await fetchFile(uriSrc.uri, uriSrc.name, {
        cache: extra?.fetchFileCache,
      });
      execute({
        ...dataSource,
        fileSrc: {
          file,
          fileType: '',
        },
      });
      return done();
    } catch (err) {
      throw new Error(`Could not download URL ${uriSrc.uri}`, {
        cause: err instanceof Error ? err : undefined,
      });
    }
  }
  return dataSource;
};

export default downloadUrl;
