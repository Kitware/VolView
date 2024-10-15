import { getFileMimeType } from '@/src/io';
import { ImportHandler } from '@/src/io/import/common';

/**
 * Transforms a file data source to have a mime type
 * @param dataSource
 */
const updateFileMimeType: ImportHandler = async (dataSource) => {
  let src = dataSource;
  const { fileSrc } = src;
  if (fileSrc) {
    const mime = await getFileMimeType(fileSrc.file);
    if (mime) {
      src = {
        ...src,
        fileSrc: {
          ...fileSrc,
          fileType: mime,
        },
      };
    }
  }
  return src;
};

export default updateFileMimeType;
