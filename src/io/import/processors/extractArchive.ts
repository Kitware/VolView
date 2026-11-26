import { extractFilesFromZip } from '@/src/io/zip';
import {
  ImportHandler,
  type ArchiveCache,
  asIntermediateResult,
  isArchive,
} from '@/src/io/import/common';
import { Skip } from '@/src/utils/evaluateChain';
import { DataSource, findStateFileLeaves } from '@/src/io/import/dataSource';

const withoutLeadingSlashes = (path: string) => path.replace(/^\/+/, '');

const readArchive = (file: File, cache?: ArchiveCache) => {
  const cached = cache?.get(file);
  if (cached) return cached;
  const pending = extractFilesFromZip(file).then((entries) =>
    entries.map((entry) => ({
      path: withoutLeadingSlashes(entry.archivePath),
      file: entry.file,
    }))
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
      ? [
          {
            path: target,
            file: contents.find(
              ({ path }) => path === withoutLeadingSlashes(target)
            )?.file,
          },
        ]
      : contents;
    const newSources = entries.map(({ path, file }): DataSource => {
      if (!file)
        throw new Error('File ' + path + ' does not exist in the zip file');
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
          path,
          parent: dataSource,
        },
      };
    });
    return asIntermediateResult(newSources);
  }
  return Skip;
};

export default extractArchive;
