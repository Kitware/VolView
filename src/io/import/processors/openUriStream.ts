import { Skip } from '@/src/utils/evaluateChain';
import { CachedStreamFetcher } from '@/packages/dicom/core';
import { useDicomRuntimeStore } from '@/src/store/dicom-runtime';
import {
  ImportHandler,
  asIntermediateResult,
  type ImportContext,
} from '@/src/io/import/common';
import { canFetchUrl, fetchFile } from '@/src/utils/fetch';
import { extractFilenameFromContentDisposition } from '@/src/utils/parseContentDispositionHeader';
import { basename } from '@/src/utils/path';
import {
  findStateFileLeaves,
  type DataSource,
  type UriSource,
} from '@/src/io/import/dataSource';

const savedArchiveFile = async (
  dataSource: DataSource & UriSource,
  context?: ImportContext
) => {
  if (!findStateFileLeaves(dataSource)[0]?.archivePaths?.length) return null;
  const file = await fetchFile(dataSource.uri, dataSource.name, {
    cache: context?.fetchFileCache,
  });
  return {
    type: 'file' as const,
    file,
    fileType: dataSource.mime ?? file.type,
    parent: dataSource,
  };
};

const openUriStream: ImportHandler = async (dataSource, context) => {
  if (dataSource.type !== 'uri' || !canFetchUrl(dataSource.uri)) {
    return Skip;
  }

  if (dataSource.fetcher?.connected) {
    return Skip;
  }

  const archive = await savedArchiveFile(dataSource, context);
  if (archive) return asIntermediateResult([archive]);

  const fetcher = new CachedStreamFetcher(dataSource.uri, {
    fetch: useDicomRuntimeStore().loader.fetch,
  });

  await fetcher.connect();

  const filenameFromHeader = extractFilenameFromContentDisposition(
    fetcher.contentDisposition
  );

  // Only use Content-Disposition if current name lacks an extension
  // (indicating it's likely auto-derived from URL like "download" or "getImage")
  const hasExtension = basename(dataSource.name).lastIndexOf('.') > 0;
  const finalName =
    !hasExtension && filenameFromHeader ? filenameFromHeader : dataSource.name;

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
