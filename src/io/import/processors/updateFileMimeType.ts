import { Skip } from '@/src/utils/evaluateChain';
import { getFileMimeType } from '@/src/io';
import { ImportHandler, asIntermediateResult } from '@/src/io/import/common';
import { MIME_TYPES } from '@/src/io/mimeTypes';

/**
 * Transforms a file data source to have a mime type
 * @param dataSource
 */
const updateFileMimeType: ImportHandler = async (dataSource) => {
  if (dataSource.type !== 'file') return Skip;

  const knownType =
    dataSource.fileType !== '' && MIME_TYPES.has(dataSource.fileType);
  if (knownType) {
    return Skip;
  }

  const mime = await getFileMimeType(dataSource.file);

  if (!mime) {
    throw new Error(
      `Unrecognized file type for "${dataSource.file.name}". This file format is not supported.`
    );
  }

  return asIntermediateResult([
    {
      ...dataSource,
      fileType: mime,
    },
  ]);
};

export default updateFileMimeType;
