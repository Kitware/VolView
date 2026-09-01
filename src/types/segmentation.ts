import type { RGBAColor, TypedArray } from '@kitware/vtk.js/types';

import { hexaToRGBA, rgbaToHexa } from '@/src/utils/color';
import type vtkLabelMap from '@/src/vtk/LabelMap';

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
  fillOpacity: number;
  outlineOpacity: number;
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
  fillOpacity: number;
  outlineOpacity: number;
  outlineThickness: number;
};

/**
 * The voxel operations every labelmap consumer routes through. Storage is one
 * full-extent mask per artifact, so `ensureContains` can only assert.
 *
 * `ensureContains` may replace the scalar array, dimensions and strides:
 * anything that cached those from `image()` or `scalars()` must re-fetch after
 * calling it.
 */
export type VoxelStorage = {
  /**
   * Whether the storage is still reachable. An accessor outlives what it
   * points at, so callers holding one across a deletion check this before a
   * read or a write; every other method throws while it is false.
   */
  exists(): boolean;
  /** The live labelmap. */
  image(): vtkLabelMap;
  /** The live buffer, not a copy: writes through it land in storage. */
  scalars(): TypedArray;
  /** Copy-out of the whole mask, every label value included. */
  snapshot(): TypedArray;
  /** Bulk copy-in; keeps image() and scalars() identity, marks it modified. */
  apply(scalars: TypedArray | number[]): void;
  /**
   * Ensures storage covers `extent`, growing if needed. Returns whether
   * storage was invalidated (scalars/dimensions/strides changed). Throws when
   * the extent cannot be covered.
   */
  ensureContains(extent: Extent3D): boolean;
};

/**
 * Voxel access for one segment. Re-resolves the binding on every call rather
 * than capturing it, so a caller that holds an accessor across a segment
 * deletion or a growth sees the current state, not a stale one. `exists()` is
 * false, and every storage method throws, before `materialize()`.
 */
export type SegmentVoxelAccessor = VoxelStorage & {
  /** The current binding, or undefined before any voxels are allocated. */
  binding(): LabelmapBinding | undefined;
  /** Allocates storage if needed and returns the binding. Idempotent. */
  materialize(): LabelmapBinding;
};

/** Segments in display order. `order` is the authority, `segments` the store. */
export function listSegments(segmentation: Segmentation) {
  return segmentation.order.map((id) => segmentation.segments[id]);
}

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
// Config and legacy manifests accept any CSS color string, so the functional
// syntaxes are parsed too: falling back to black silently discarded them.
const RGB_COLOR = /^rgba?\(([^)]+)\)$/;
const HSL_COLOR = /^hsla?\(([^)]+)\)$/;

const splitArgs = (body: string) =>
  body
    .replace(/\//g, ' ')
    .split(/[\s,]+/)
    .filter(Boolean);

const toAlpha = (raw: string | undefined) => {
  if (raw === undefined) return 255;
  const value = raw.endsWith('%')
    ? Number(raw.slice(0, -1)) / 100
    : Number(raw);
  return Number.isFinite(value)
    ? Math.round(Math.min(Math.max(value, 0), 1) * 255)
    : 255;
};

const toChannel = (raw: string) => {
  const value = raw.endsWith('%')
    ? (Number(raw.slice(0, -1)) / 100) * 255
    : Number(raw);
  return Math.round(Math.min(Math.max(value, 0), 255));
};

/** h in degrees, s and l in 0..1, per the CSS hsl() to rgb() conversion. */
const hslToRGB = (h: number, s: number, l: number) => {
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = chroma * (1 - Math.abs((hp % 2) - 1));
  const [r, g, b] = (
    [
      [chroma, x, 0],
      [x, chroma, 0],
      [0, chroma, x],
      [0, x, chroma],
      [x, 0, chroma],
      [chroma, 0, x],
    ] as const
  )[Math.floor(hp) % 6];
  const m = l - chroma / 2;
  return [r + m, g + m, b + m].map((c) =>
    Math.round(Math.min(Math.max(c, 0), 1) * 255)
  ) as [number, number, number];
};

/** The parsed color, or undefined when the string is not a CSS color we know. */
export function tryCssColorToRGBA(css: string): RGBAColor | undefined {
  const value = css.trim().toLowerCase();
  if (value === 'transparent') return [0, 0, 0, 0];

  const hex = NAMED_COLORS[value] ?? HEX_COLOR.exec(value)?.[1];
  if (hex) return hexaToRGBA(expandShorthandHex(hex));

  const rgb = RGB_COLOR.exec(value);
  if (rgb) {
    const args = splitArgs(rgb[1]);
    if (args.length < 3) return undefined;
    const channels = args.slice(0, 3).map(toChannel);
    if (channels.some((c) => !Number.isFinite(c))) return undefined;
    return [...channels, toAlpha(args[3])] as RGBAColor;
  }

  const hsl = HSL_COLOR.exec(value);
  if (hsl) {
    const args = splitArgs(hsl[1]);
    if (args.length < 3) return undefined;
    const h = Number(args[0].replace(/deg$/, ''));
    const sat = Number(args[1].replace(/%$/, '')) / 100;
    const light = Number(args[2].replace(/%$/, '')) / 100;
    if (![h, sat, light].every(Number.isFinite)) return undefined;
    return [...hslToRGB(h, sat, light), toAlpha(args[3])] as RGBAColor;
  }

  return undefined;
}

export function cssColorToRGBA(css: string): RGBAColor {
  return tryCssColorToRGBA(css) ?? [0, 0, 0, 255];
}

// Opaque colors keep the 6-digit form label colors are written in, so a color
// that round trips through a segment comes back byte-identical.
export function rgbaToCssColor(rgba: RGBAColor) {
  const hexa = rgbaToHexa(rgba);
  return rgba[3] === 255 ? hexa.slice(0, 7) : hexa;
}
