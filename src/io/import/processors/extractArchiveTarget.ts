import {
  asIntermediateResult,
  ImportHandler,
  isArchive,
} from '@/src/io/import/common';
import { extractFileFromZip } from '@/src/io/zip';
import { Skip } from '@/src/utils/evaluateChain';

/**
 * Extracts a single target file from an archive.
 *
 * If the fileSrc already exists, nothing is done. Otherwise, attempt to
 * extract the file from the parent archive.
 *
 * Input data source must be of the following form:
 * { archiveSrc, parent: DataSource with a fileSrc }
 * @param dataSource
 * @returns
 */
const extractArchiveTarget: ImportHandler = async (dataSource) => {
  if (dataSource.type !== 'archive') return Skip;

  if (!isArchive(dataSource.parent)) {
    throw new Error('Parent is not a supported archive file');
  }

  const targetFile = await extractFileFromZip(
    dataSource.parent.file,
    dataSource.path
  );

  return asIntermediateResult([
    {
      type: 'file',
      file: targetFile,
      fileType: '',
      parent: dataSource,
    },
  ]);
};

export default extractArchiveTarget;
