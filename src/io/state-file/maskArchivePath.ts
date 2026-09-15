import { normalize } from '@/src/utils/path';
import { sanitizeFileStem } from '@/src/io/fileName';

export const DEFAULT_MASK_ARCHIVE_STEM = 'Segment Group';
const MASK_ARCHIVE_DIR = 'segmentations';

export function sanitizeSegmentationFileStem(
  name: string,
  fallback = DEFAULT_MASK_ARCHIVE_STEM
) {
  return sanitizeFileStem(name, fallback);
}

function makeArchivePathKey(path: string) {
  return normalize(path).toLowerCase();
}

export function makeMaskArchivePath(
  name: string,
  extension: string,
  usedPaths: Set<string>
) {
  const stem = sanitizeSegmentationFileStem(name);

  let index = 1;
  let path = normalize(`${MASK_ARCHIVE_DIR}/${stem}.${extension}`);
  while (usedPaths.has(makeArchivePathKey(path))) {
    index += 1;
    path = normalize(`${MASK_ARCHIVE_DIR}/${stem} (${index}).${extension}`);
  }

  usedPaths.add(makeArchivePathKey(path));
  return path;
}
