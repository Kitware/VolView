import { Skip } from '@/src/utils/evaluateChain';
import { Chunk } from '@/src/core/streaming/chunk';
import { DicomFileDataLoader } from '@/src/core/streaming/dicom/dicomFileDataLoader';
import { DicomFileMetaLoader } from '@/src/core/streaming/dicom/dicomFileMetaLoader';
import { ReadDicomTagsFunction } from '@/src/core/streaming/dicom/dicomMetaLoader';
import { ImportHandler, asIntermediateResult } from '@/src/io/import/common';
import { getWorker } from '@/src/io/itk/worker';
import { FILE_EXT_TO_MIME } from '@/src/io/mimeTypes';
import { readDicomTags } from '@itk-wasm/dicom';

/**
 * Adds DICOM files to the extra context.
 * @param dataSource
 * @returns
 */
const handleDicomFile: ImportHandler = async (dataSource) => {
  if (
    dataSource.type !== 'file' ||
    dataSource.fileType !== FILE_EXT_TO_MIME.dcm
  ) {
    return Skip;
  }

  const readTags: ReadDicomTagsFunction = async (file) => {
    const result = await readDicomTags(file, { webWorker: getWorker() });
    return result.tags;
  };

  const metaLoader = new DicomFileMetaLoader(dataSource.file, readTags);
  const dataLoader = new DicomFileDataLoader(dataSource.file);
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

export default handleDicomFile;
