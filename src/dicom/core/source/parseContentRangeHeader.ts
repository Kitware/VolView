const CONTENT_RANGE_REGEXP =
  /^bytes (?<start>\d+)-(?<end>\d+)\/(?<length>\d+|\*)$/;

type ContentRange =
  | { type: 'empty-range' }
  | { type: 'invalid-range' }
  | { type: 'range'; start: number; end: number; length: number | null };

/** Parses a 206 response's Content-Range, where an unsatisfied `*` range is invalid. */
export function parseContentRangeHeader(
  headerValue: string | null
): ContentRange {
  if (headerValue == null) return { type: 'empty-range' };

  const groups = CONTENT_RANGE_REGEXP.exec(headerValue)?.groups;
  if (!groups) return { type: 'invalid-range' };

  const start = parseInt(groups.start, 10);
  const end = parseInt(groups.end, 10);
  const length = groups.length === '*' ? null : parseInt(groups.length, 10);

  if (end < start || (length !== null && length <= end))
    return { type: 'invalid-range' };

  return { type: 'range', start, end, length };
}
