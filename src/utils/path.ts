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
 *
 * Splits on both forward and backslashes so a Windows-style path or zip entry
 * name yields its final segment too.
 * @param path
 * @returns
 */
export function basename(path: string) {
  return path.split(/[\\/]+/g).at(-1) ?? path;
}

/**
 * Extensions whose meaning spans more than one dotted segment.
 */
export const COMPOUND_EXTENSIONS = ['nii.gz', 'iwi.cbor', 'seg.nrrd'];

/**
 * Returns the base name of a path without its extension.
 *
 * Compound-aware, so "scan.nii.gz" yields "scan" rather than "scan.nii". A
 * leading dot is kept: ".nrrd" is a name, not an extension.
 * @param path
 * @returns
 */
export function stripExtension(path: string) {
  const base = basename(path);
  const lower = base.toLowerCase();
  const compound = COMPOUND_EXTENSIONS.find((ext) => lower.endsWith(`.${ext}`));
  if (compound) return base.slice(0, -(compound.length + 1));
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
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

/**
 * Joins path segments with / and normalizes the result.
 * @param segments
 */
export function join(...segments: string[]) {
  return normalize(segments.join('/'));
}
