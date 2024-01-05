import { getRequestPool } from '@/src/core/streaming/requestPool';
import { ResumableFetcher } from '@/src/core/streaming/resumableFetcher';
import { ImportHandler } from '@/src/io/import/common';
import { canFetchUrl } from '@/src/utils/fetch';

const openUriStream: ImportHandler = async (dataSource, { onCleanup }) => {
  const { uriSrc } = dataSource;
  if (!uriSrc || !canFetchUrl(uriSrc.uri)) {
    return dataSource;
  }

  if (uriSrc.fetcher?.connected) {
    return dataSource;
  }

  const fetcher = new ResumableFetcher(uriSrc.uri, {
    fetch: (...args) => getRequestPool().fetch(...args),
  });

  await fetcher.connect();

  // ensure we close the connection on completion
  onCleanup(() => {
    fetcher.close();
  });

  return {
    ...dataSource,
    uriSrc: {
      ...uriSrc,
      fetcher,
    },
  };
};

export default openUriStream;
