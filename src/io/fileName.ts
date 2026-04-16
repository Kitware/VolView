const TRAILING_DOTS_AND_SPACES = /[. ]+$/g;
const REPEATED_WHITESPACE = /\s+/g;
const WINDOWS_RESERVED_FILE_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const INVALID_FILE_STEM_CHARS = new Set([
  '<',
  '>',
  ':',
  '"',
  '/',
  '\\',
  '|',
  '?',
  '*',
]);

export const DEFAULT_FILE_STEM = 'File';

export function sanitizeFileStem(name: string, fallback = DEFAULT_FILE_STEM) {
  let sanitized = name
    .split('')
    .map((char) => {
      const isControlCharacter = char.charCodeAt(0) < 32;
      return isControlCharacter || INVALID_FILE_STEM_CHARS.has(char)
        ? ' '
        : char;
    })
    .join('')
    .replace(REPEATED_WHITESPACE, ' ')
    .trim()
    .replace(TRAILING_DOTS_AND_SPACES, '');

  if (WINDOWS_RESERVED_FILE_NAME.test(sanitized)) {
    sanitized = `${sanitized}_`;
  }

  return sanitized || fallback;
}
