import type { RGBAColor } from '@kitware/vtk.js/types';

import { hexaToRGBA, rgbaToHexa } from '@/src/utils/color';

/** vtk.js index-space extent order: [iMin, iMax, jMin, jMax, kMin, kMax]. */
export type Extent3D = [number, number, number, number, number, number];

export type LabelmapBinding = {
  artifactId: string;
  labelValue: number;
  extent: Extent3D; // parent image index space; full parent extent in this phase
};

export type Segment = {
  id: string;
  name: string;
  color: RGBAColor;
  visible: boolean;
  locked: boolean;
  representations: {
    // absent until voxels are allocated
    labelmap?: LabelmapBinding;
  };
};

/**
 * One artifact's label descriptor, derived from the segments bound to it.
 * Identity lives on `Segment`; this is the value-keyed view the labelmap
 * renderer and the .seg.nrrd writer consume.
 */
export type LabelmapSegment = {
  value: number;
  name: string;
  color: RGBAColor;
  visible: boolean;
  locked?: boolean;
};

export type Segmentation = {
  id: string;
  name: string;
  parentImageId: string;
  segments: Record<string, Segment>;
  order: string[];
};

export type ActiveSegmentationTarget = {
  segmentationId: string;
  segmentId: string;
};

export type ActiveSegmentIntent = {
  name: string;
  color: RGBAColor;
  targetByImageId: Record<string, ActiveSegmentationTarget>;
};

export function emptyExtent(): Extent3D {
  return [0, -1, 0, -1, 0, -1];
}

/** vtk.js extents are inclusive, so an axis is empty only when max < min. */
export function isEmptyExtent(extent: Extent3D) {
  return (
    extent[1] < extent[0] || extent[3] < extent[2] || extent[5] < extent[4]
  );
}

// CSS basic color keywords; the vector tool label defaults in src/config.ts use 'red'.
const NAMED_COLORS: Record<string, string> = {
  black: '000000',
  silver: 'c0c0c0',
  gray: '808080',
  white: 'ffffff',
  maroon: '800000',
  red: 'ff0000',
  purple: '800080',
  fuchsia: 'ff00ff',
  green: '008000',
  lime: '00ff00',
  olive: '808000',
  yellow: 'ffff00',
  navy: '000080',
  blue: '0000ff',
  teal: '008080',
  aqua: '00ffff',
};

const HEX_COLOR = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/;

const expandShorthandHex = (hex: string) =>
  hex.length <= 4
    ? hex
        .split('')
        .map((digit) => digit.repeat(2))
        .join('')
    : hex;

/**
 * Parses the CSS color strings label colors are stored as (hex, with or
 * without an alpha channel, plus the basic color keywords). Unparseable input
 * falls back to opaque black so migrating a state file cannot throw.
 */
export function cssColorToRGBA(css: string): RGBAColor {
  const value = css.trim().toLowerCase();
  const hex = NAMED_COLORS[value] ?? HEX_COLOR.exec(value)?.[1];
  if (!hex) return [0, 0, 0, 255];
  return hexaToRGBA(expandShorthandHex(hex));
}

// Opaque colors keep the 6-digit form label colors are written in, so a color
// that round trips through a segment comes back byte-identical.
export function rgbaToCssColor(rgba: RGBAColor) {
  const hexa = rgbaToHexa(rgba);
  return rgba[3] === 255 ? hexa.slice(0, 7) : hexa;
}
