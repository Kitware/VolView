import { extractFilesFromZip } from '@/src/io/zip';
import {
  ImportHandler,
  asIntermediateResult,
  isArchive,
} from '@/src/io/import/common';
import { Skip } from '@/src/utils/evaluateChain';

/**
 * Extracts all files from an archive.
 * @param dataSource
 */
const extractArchive: ImportHandler = async (dataSource) => {
  if (isArchive(dataSource)) {
    const files = await extractFilesFromZip(dataSource.fileSrc.file);
    const newSources = files.map((entry) => {
      return {
        fileSrc: {
          file: entry.file,
          fileType: '',
        },
        archiveSrc: {
          path: entry.archivePath,
        },
        parent: dataSource,
      };
    });
    return asIntermediateResult(newSources);
  }
  return Skip;
};

export default extractArchive;
