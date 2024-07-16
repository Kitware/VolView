import { Skip } from '@/src/utils/evaluateChain';
import { CachedStreamFetcher } from '@/src/core/streaming/cachedStreamFetcher';
import { getRequestPool } from '@/src/core/streaming/requestPool';
import { ImportHandler, asIntermediateResult } from '@/src/io/import/common';
import { canFetchUrl } from '@/src/utils/fetch';

const openUriStream: ImportHandler = async (dataSource, context) => {
  const { uriSrc } = dataSource;
  if (!uriSrc || !canFetchUrl(uriSrc.uri)) {
    return Skip;
  }

  if (uriSrc.fetcher?.connected) {
    return Skip;
  }

  const fetcher = new CachedStreamFetcher(uriSrc.uri, {
    fetch: (...args) => getRequestPool().fetch(...args),
  });

  await fetcher.connect();

  // ensure we close the connection on completion
  context?.onCleanup?.(() => {
    fetcher.close();
  });

  return asIntermediateResult([
    {
      ...dataSource,
      uriSrc: {
        ...uriSrc,
        fetcher,
      },
    },
  ]);
};

export default openUriStream;
