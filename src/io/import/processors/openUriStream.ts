import { Skip } from '@/src/utils/evaluateChain';
import { CachedStreamFetcher } from '@/src/core/streaming/cachedStreamFetcher';
import { getRequestPool } from '@/src/core/streaming/requestPool';
import { ImportHandler, asIntermediateResult } from '@/src/io/import/common';
import { canFetchUrl } from '@/src/utils/fetch';
import { extractFilenameFromContentDisposition } from '@/src/utils/parseContentDispositionHeader';

const openUriStream: ImportHandler = async (dataSource, context) => {
  if (dataSource.type !== 'uri' || !canFetchUrl(dataSource.uri)) {
    return Skip;
  }

  if (dataSource.fetcher?.connected) {
    return Skip;
  }

  const fetcher = new CachedStreamFetcher(dataSource.uri, {
    fetch: (...args) => getRequestPool().fetch(...args),
  });

  await fetcher.connect();

  const filenameFromHeader = extractFilenameFromContentDisposition(
    fetcher.contentDisposition
  );

  const finalName = filenameFromHeader || dataSource.name;

  // ensure we close the connection on completion
  context?.onCleanup?.(() => {
    fetcher.close();
  });

  return asIntermediateResult([
    {
      ...dataSource,
      name: finalName,
      fetcher,
    },
  ]);
};

export default openUriStream;
