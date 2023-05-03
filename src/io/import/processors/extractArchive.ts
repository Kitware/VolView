import { extractFilesFromZip } from '@/src/io/zip';
import { ImportHandler, isArchive } from '@/src/io/import/common';

/**
 * Extracts all files from an archive.
 * @param dataSource
 */
const extractArchive: ImportHandler = async (dataSource, { execute, done }) => {
  if (isArchive(dataSource)) {
    const files = await extractFilesFromZip(dataSource.fileSrc.file);
    files.forEach((entry) => {
      execute({
        fileSrc: {
          file: entry.file,
          fileType: '',
        },
        archiveSrc: {
          path: `${entry.archivePath}/${entry.file.name}`,
        },
        parent: dataSource,
      });
    });
    return done();
  }
  return dataSource;
};

export default extractArchive;
