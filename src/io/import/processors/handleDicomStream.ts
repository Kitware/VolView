import { Skip } from '@/src/utils/evaluateChain';
import { CachedStreamFetcher } from '@/src/core/streaming/cachedStreamFetcher';
import { Chunk } from '@/src/core/streaming/chunk';
import { DicomDataLoader } from '@/src/core/streaming/dicom/dicomDataLoader';
import {
  DicomMetaLoader,
  ReadDicomTagsFunction,
} from '@/src/core/streaming/dicom/dicomMetaLoader';
import { getRequestPool } from '@/src/core/streaming/requestPool';
import { ImportHandler, asIntermediateResult } from '@/src/io/import/common';
import { getWorker } from '@/src/io/itk/worker';
import { FILE_EXT_TO_MIME } from '@/src/io/mimeTypes';
import { readDicomTags } from '@itk-wasm/dicom';

const handleDicomStream: ImportHandler = async (dataSource) => {
  if (dataSource.type !== 'uri' || dataSource?.mime !== FILE_EXT_TO_MIME.dcm) {
    return Skip;
  }

  const fetcher =
    dataSource.fetcher ??
    new CachedStreamFetcher(dataSource.uri, {
      fetch: (...args) => getRequestPool().fetch(...args),
    });

  const readTags: ReadDicomTagsFunction = async (file) => {
    try {
      const result = await readDicomTags(file, { webWorker: getWorker() });
      return result.tags;
    } catch (error) {
      throw new Error(
        `Failed to read DICOM tags from ${dataSource.uri}: ${error}`
      );
    }
  };

  const metaLoader = new DicomMetaLoader(fetcher, readTags);
  const dataLoader = new DicomDataLoader(fetcher);
  const chunk = new Chunk({
    metaLoader,
    dataLoader,
  });

  await chunk.loadMeta();

  return asIntermediateResult([
    {
      type: 'chunk',
      chunk,
      mime: FILE_EXT_TO_MIME.dcm,
      parent: dataSource,
    },
  ]);
};

export default handleDicomStream;
