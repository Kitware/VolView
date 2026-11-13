import { extractFilesFromZip } from '@/src/io/zip';
import {
  ImportHandler,
  type ArchiveCache,
  asIntermediateResult,
  isArchive,
} from '@/src/io/import/common';
import { Skip } from '@/src/utils/evaluateChain';
import { DataSource, findStateFileLeaves } from '@/src/io/import/dataSource';

const readArchive = (file: File, cache?: ArchiveCache) => {
  const cached = cache?.get(file);
  if (cached) return cached;
  const pending = extractFilesFromZip(file).then((entries) =>
    Object.fromEntries(
      entries.map((entry) => [
        entry.archivePath.replace(/^\/+/, ''),
        entry.file,
      ])
    )
  );
  cache?.set(file, pending);
  return pending;
};

/**
 * Extracts all files from an archive.
 * @param dataSource
 */
const extractArchive: ImportHandler = async (dataSource, context) => {
  if (isArchive(dataSource)) {
    const leaf = findStateFileLeaves(dataSource)[0];
    const [target, ...remaining] = leaf?.archivePaths ?? [];
    const contents = await readArchive(dataSource.file, context?.archiveCache);
    const entries = target
      ? ([[target, contents[target.replace(/^\/+/, '')]]] as const)
      : Object.entries(contents);
    const newSources = entries.map(([archivePath, file]): DataSource => {
      if (!file)
        throw new Error(
          'File ' + archivePath + ' does not exist in the zip file'
        );
      return {
        type: 'file',
        file,
        fileType: '',
        ...(leaf
          ? {
              stateFileLeaf: {
                stateID: leaf.stateID,
                ...(remaining.length ? { archivePaths: remaining } : {}),
              },
            }
          : {}),
        parent: {
          type: 'archive',
          path: archivePath,
          parent: dataSource,
        },
      };
    });
    return asIntermediateResult(newSources);
  }
  return Skip;
};

export default extractArchive;
