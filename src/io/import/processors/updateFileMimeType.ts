import { Skip } from '@/src/utils/evaluateChain';
import { getFileMimeType } from '@/src/io';
import { ImportHandler, asIntermediateResult } from '@/src/io/import/common';

/**
 * Transforms a file data source to have a mime type
 * @param dataSource
 */
const updateFileMimeType: ImportHandler = async (dataSource) => {
  const { fileSrc } = dataSource;
  if (!fileSrc || fileSrc.fileType !== '') return Skip;

  const mime = await getFileMimeType(fileSrc.file);
  if (!mime) {
    throw new Error('File is unsupported');
  }

  return asIntermediateResult([
    {
      ...dataSource,
      fileSrc: {
        ...fileSrc,
        fileType: mime,
      },
    },
  ]);
};

export default updateFileMimeType;
