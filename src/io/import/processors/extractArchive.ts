import { extractFilesFromZip } from '@/src/io/zip';
import {
  ImportHandler,
  asIntermediateResult,
  isArchive,
} from '@/src/io/import/common';
import { Skip } from '@/src/utils/evaluateChain';
import { DataSource } from '@/src/io/import/dataSource';

/**
 * Extracts all files from an archive.
 * @param dataSource
 */
const extractArchive: ImportHandler = async (dataSource) => {
  if (isArchive(dataSource)) {
    const files = await extractFilesFromZip(dataSource.file);
    const newSources = files.map((entry): DataSource => {
      return {
        type: 'file',
        file: entry.file,
        fileType: '',
        parent: {
          type: 'archive',
          path: entry.archivePath,
          parent: dataSource,
        },
      };
    });
    return asIntermediateResult(newSources);
  }
  return Skip;
};

export default extractArchive;
