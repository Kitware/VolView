import { normalize } from '@/src/utils/path';
import { sanitizeFileStem } from '@/src/io/fileName';

export const DEFAULT_SEGMENT_GROUP_ARCHIVE_STEM = 'Segment Group';

export function sanitizeSegmentGroupFileStem(
  name: string,
  fallback = DEFAULT_SEGMENT_GROUP_ARCHIVE_STEM
) {
  return sanitizeFileStem(name, fallback);
}

function makeArchivePathKey(path: string) {
  return normalize(path).toLowerCase();
}

export function makeSegmentGroupArchivePath(
  name: string,
  extension: string,
  usedPaths: Set<string>
) {
  const stem = sanitizeSegmentGroupFileStem(name);

  let index = 1;
  let path = normalize(`labels/${stem}.${extension}`);
  while (usedPaths.has(makeArchivePathKey(path))) {
    index += 1;
    path = normalize(`labels/${stem} (${index}).${extension}`);
  }

  usedPaths.add(makeArchivePathKey(path));
  return path;
}
