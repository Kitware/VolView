/**
 * Converts an RGBA tuple to a hex string with alpha.
 *
 * Adds the prefix '#'.
 *
 * @param rgba a 4-tuple with components ranging from 0-255.
 */
export function rgbaToHexa(rgba: number[]) {
  const hexa = rgba.map((comp) => `0${comp.toString(16)}`.slice(-2));
  return `#${hexa.join('')}`;
}

/**
 * Parses a hex color with optional alpha channel.
 *
 * Returns an RGBA array with components scaled to [0,255].
 *
 * @param hexa a hexa color in the format "[#]RRGGBB[AA]"
 */
export function hexaToRGBA(hexa: string) {
  const values = hexa.startsWith('#') ? hexa.substring(1) : hexa;
  const rgba = [0, 0, 0, 255];
  const length = Math.min(4, values.length / 2);
  for (let i = 0; i < length; i++) {
    rgba[i] = Number.parseInt(values.substring(2 * i, 2 * i + 2), 16);
  }
  return rgba;
}
