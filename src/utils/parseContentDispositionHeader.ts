const CONTENT_DISPOSITION_FILENAME_REGEXP =
  /filename\s*=\s*(?:"([^"]*)"|([^;\s]*))/i;

export type ContentDisposition = {
  type: 'inline' | 'attachment' | 'invalid';
  filename: string | null;
};

export function parseContentDispositionHeader(
  headerValue: string | null
): ContentDisposition {
  if (headerValue == null || headerValue.length === 0) {
    return { type: 'invalid', filename: null };
  }

  const trimmed = headerValue.trim().toLowerCase();

  let disposition: 'inline' | 'attachment' | 'invalid' = 'invalid';
  if (trimmed.startsWith('inline')) {
    disposition = 'inline';
  } else if (trimmed.startsWith('attachment')) {
    disposition = 'attachment';
  }

  if (disposition === 'invalid') {
    return { type: 'invalid', filename: null };
  }

  const match = CONTENT_DISPOSITION_FILENAME_REGEXP.exec(headerValue);
  const filename = match ? match[1] || match[2] || null : null;

  return {
    type: disposition,
    filename: filename && filename.length > 0 ? filename : null,
  };
}

export function extractFilenameFromContentDisposition(
  headerValue: string | null
): string | null {
  const parsed = parseContentDispositionHeader(headerValue);
  return parsed.filename;
}
