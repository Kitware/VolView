import { Skip } from '@/src/utils/evaluateChain';
import { getFileMimeType } from '@/src/io';
import { ImportHandler, asIntermediateResult } from '@/src/io/import/common';

/**
 * Transforms a file data source to have a mime type
 * @param dataSource
 */
const updateFileMimeType: ImportHandler = async (dataSource) => {
  if (dataSource.type !== 'file' || dataSource.fileType !== '') return Skip;

  const mime = await getFileMimeType(dataSource.file);
  if (!mime) {
    throw new Error('File is unsupported');
  }

  return asIntermediateResult([
    {
      ...dataSource,
      fileType: mime,
    },
  ]);
};

export default updateFileMimeType;
