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
 *
 * @param hexa a hexa color in the format "#AABBCCDD"
 */
export function hexaToRGBA(hexa: string) {
  const rgba = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) {
    rgba[i] = Number.parseInt(hexa.substring(i + 1, i + 3), 16);
  }
  return rgba;
}
