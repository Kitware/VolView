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
  const { fileSrc, archiveSrc, parent } = dataSource;

  if (!fileSrc && archiveSrc && parent) {
    if (!parent?.fileSrc) {
      throw new Error(
        'Cannot extract an archive target with an unresolved parent'
      );
    }

    if (!isArchive(parent)) {
      throw new Error('Parent is not a supported archive file');
    }

    const targetFile = await extractFileFromZip(
      parent.fileSrc.file,
      archiveSrc.path
    );

    return asIntermediateResult([
      {
        ...dataSource,
        fileSrc: {
          file: targetFile,
          fileType: '',
        },
      },
    ]);
  }

  return Skip;
};

export default extractArchiveTarget;
