const CONTENT_RANGE_REGEXP =
  /^bytes (?<range>(?<start>\d+)-(?<end>\d+)|\*)\/(?<length>\d+|\*)$/;

export type ContentRange =
  | { type: 'empty-range' }
  | { type: 'invalid-range' }
  | { type: 'unsatisfied-range'; length: number }
  | { type: 'range'; start: number; end: number; length: number | null };

/**
 * Parses a Content-Range header.
 *
 * Only supports bytes ranges.
 * @param headerValue
 * @returns
 */
export function parseContentRangeHeader(
  headerValue: string | null
): ContentRange {
  if (headerValue == null) return { type: 'empty-range' };
  if (headerValue.length === 0) return { type: 'invalid-range' };

  const match = CONTENT_RANGE_REGEXP.exec(headerValue);
  const groups = match?.groups;
  if (!groups) return { type: 'invalid-range' };

  const length = groups.length === '*' ? null : parseInt(groups.length, 10);

  if (groups.range === '*') {
    if (length === null) return { type: 'invalid-range' };
    return { type: 'unsatisfied-range', length };
  }

  const start = parseInt(groups.start, 10);
  const end = parseInt(groups.end, 10);

  if (end < start || (length !== null && length <= end))
    return { type: 'invalid-range' };

  return { type: 'range', start, end, length };
}
