/**
 * Returns the parent directory of a path.
 * @param path
 * @returns
 */
export function dirname(path: string) {
  const p = path.split(/\/+/g);
  p.splice(-1, 1);
  return p.join('/');
}

/**
 * Returns the base name of a path.
 * @param path
 * @returns
 */
export function basename(path: string) {
  return path.split(/\/+/g).at(-1) ?? path;
}

/**
 * Normalizes a string.
 *
 * "a//b" and "a/b/" become "a/b".
 * @param path
 * @returns
 */
export function normalize(path: string) {
  return path.replace(/\/+/g, '/').replace(/\/$/, '');
}
