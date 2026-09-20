import type { RGBAColor } from '@kitware/vtk.js/types';
import colorNames from 'color-name';
import { hexaToRGBA, rgbaToHexa } from '@/src/utils/color';

// A Map, not the package's plain object: prototype keys such as 'constructor'
// must not be mistaken for colors.
const NAMED_COLORS = new Map(Object.entries(colorNames));

const HEX_COLOR = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/;

const expandShorthandHex = (hex: string) =>
  hex.length <= 4
    ? hex
        .split('')
        .map((digit) => digit.repeat(2))
        .join('')
    : hex;

/** Parses `transparent`, the CSS colour keywords, and hex. */
export function tryCssColorToRGBA(css: string): RGBAColor | undefined {
  const value = css.trim().toLowerCase();
  if (value === 'transparent') return [0, 0, 0, 0];

  const named = NAMED_COLORS.get(value);
  if (named) return [...named, 255] as RGBAColor;

  const hex = HEX_COLOR.exec(value)?.[1];
  return hex ? hexaToRGBA(expandShorthandHex(hex)) : undefined;
}

/** Falls back to opaque black for unparseable label colors. */
export function cssColorToRGBA(css: string): RGBAColor {
  return tryCssColorToRGBA(css) ?? [0, 0, 0, 255];
}

// Opaque colors keep the 6-digit form label colors are written in, so a color
// that round trips through a segment comes back byte-identical.
export function rgbaToCssColor(rgba: RGBAColor) {
  const hexa = rgbaToHexa(rgba);
  return rgba[3] === 255 ? hexa.slice(0, 7) : hexa;
}
