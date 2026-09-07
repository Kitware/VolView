import type { ProcessingResultSource } from '@/src/types';
import type { RGBAColor, TypedArray } from '@kitware/vtk.js/types';
import colorNames from 'color-name';

import { hexaToRGBA, rgbaToHexa } from '@/src/utils/color';
import type vtkLabelMap from '@/src/vtk/LabelMap';

/** vtk.js index-space extent order: [iMin, iMax, jMin, jMax, kMin, kMax]. */
export type Extent3D = [number, number, number, number, number, number];

/** A fresh segmentation tints the anatomy under it rather than hiding it. */
export const DEFAULT_SEGMENTATION_FILL_OPACITY = 0.3;

export type LabelmapBinding = {
  artifactId: string;
  labelValue: number;
  extent: Extent3D; // the mask's own bounds, in parent image index space
};

/**
 * One image's mask for one segment type. Its id is its own, distinct from the
 * type id: everything the user sees or sets, visibility and lock included,
 * lives on the type, so this record is storage and nothing else.
 */
/** What an artifact is, apart from its voxels: whose it is and where from. */
export type ArtifactMetadata = {
  parentImage: string;
  name: string;
  source?: ProcessingResultSource;
};

export type SegmentMask = {
  id: string;
  segmentId: string;
  representations: {
    // absent until voxels are allocated
    labelmap?: LabelmapBinding;
  };
};

/** The value a mask voxel carries where no segment claims it. */
export const LABELMAP_BACKGROUND_VALUE = 0;

/** The name a segment gets when nothing named it: shared by decode and paint. */
export const makeDefaultSegmentName = (value: number) => `Segment ${value}`;

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
  // Absent on descriptors that come off a file rather than off a segment.
  fillOpacity?: number;
  outlineOpacity?: number;
};

/** vtk declares getData() as number[] | TypedArray; mask storage is typed. */
export const maskScalars = (mask: vtkLabelMap) =>
  mask.getPointData().getScalars().getData() as Uint8Array;

export type Segmentation = {
  id: string;
  name: string;
  parentImageId: string;
  masks: Record<string, SegmentMask>;
  order: string[];
  fillOpacity: number;
  outlineOpacity: number;
  outlineThickness: number;
};

/** The display multipliers every segment of a segmentation is scaled by. */
export type SegmentationDisplayPatch = Partial<
  Pick<Segmentation, 'fillOpacity' | 'outlineOpacity' | 'outlineThickness'>
>;

/**
 * The voxel operations every labelmap consumer routes through. Storage is one
 * bounded mask per segment, sized to the region that segment covers.
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
  /**
   * The buffer segment- and artifact-scoped storage holds, live: a write
   * through it lands in that mask. Image-scoped storage spans a whole image
   * and owns no buffer of its own, so what it hands back is a read model, and
   * a write has to come back through `apply()` as a distinct array.
   */
  scalars(): TypedArray;
  /** Copy-out of the whole mask, every label value included. */
  snapshot(): TypedArray;
  /** Bulk copy-in; keeps image() and scalars() identity, marks it modified. */
  apply(scalars: TypedArray | number[]): void;
  /**
   * Ensures storage covers `extent`, growing to the union of what it has and
   * what it was asked for. Returns whether storage was invalidated
   * (scalars/dimensions/strides changed). An empty extent is already covered.
   * Throws when the extent leaves the parent image, so callers clip. When the
   * extent is not already covered, the mask grows by `padding` voxels beyond
   * it on every face (clipped to the parent), so nearby requests that follow
   * grow nothing.
   */
  ensureContains(extent: Extent3D, padding?: number): boolean;
};

/**
 * Voxel access for one segment. Re-resolves the binding on every call rather
 * than capturing it, so a caller that holds an accessor across a segment
 * deletion or a growth sees the current state, not a stale one. `exists()` is
 * false, and every storage method throws, before `materialize()`.
 */
export type MaskVoxelAccessor = VoxelStorage & {
  /** The current binding, or undefined before any voxels are allocated. */
  binding(): LabelmapBinding | undefined;
  /** Allocates storage if needed and returns the binding. Idempotent. */
  materialize(): LabelmapBinding;
};

/** Segments in display order. `order` is the authority, `segments` the store. */
export function listMasks(segmentation: Segmentation) {
  return segmentation.order.map((id) => segmentation.masks[id]);
}

/** Widens `box` in place to take in one more index. */
export const growExtent = (box: Extent3D, i: number, j: number, k: number) => {
  box[0] = Math.min(box[0], i);
  box[1] = Math.max(box[1], i);
  box[2] = Math.min(box[2], j);
  box[3] = Math.max(box[3], j);
  box[4] = Math.min(box[4], k);
  box[5] = Math.max(box[5], k);
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

/** Voxel counts along i, j, k. Meaningless for an empty extent. */
export function extentSize(extent: Extent3D) {
  return [
    extent[1] - extent[0] + 1,
    extent[3] - extent[2] + 1,
    extent[5] - extent[4] + 1,
  ] as [number, number, number];
}

export function extentContains(outer: Extent3D, inner: Extent3D) {
  return (
    inner[0] >= outer[0] &&
    inner[1] <= outer[1] &&
    inner[2] >= outer[2] &&
    inner[3] <= outer[3] &&
    inner[4] >= outer[4] &&
    inner[5] <= outer[5]
  );
}

export function extentContainsIndex(
  extent: Extent3D,
  i: number,
  j: number,
  k: number
) {
  return (
    i >= extent[0] &&
    i <= extent[1] &&
    j >= extent[2] &&
    j <= extent[3] &&
    k >= extent[4] &&
    k <= extent[5]
  );
}

/** A mask's extent with the row and plane strides that extent implies. */
export type MaskBounds = {
  extent: Extent3D;
  mi: number;
  mj: number;
};

/** Where a parent-index voxel sits in the buffer of a mask bounded that way. */
export const maskOffset = (
  bounds: MaskBounds,
  i: number,
  j: number,
  k: number
) =>
  i -
  bounds.extent[0] +
  (j - bounds.extent[2]) * bounds.mi +
  (k - bounds.extent[4]) * bounds.mi * bounds.mj;

/**
 * The box `labelValue` actually occupies inside a mask bounded by `extent`,
 * empty when it occupies nothing. A binding's extent is the allocation, padded
 * and never shrunk by an erase, so it is not the segment's bounds.
 */
export function markedExtent(
  scalars: ArrayLike<number>,
  extent: Extent3D,
  labelValue: number
): Extent3D {
  const ni = extent[1] - extent[0] + 1;
  const nj = extent[3] - extent[2] + 1;
  const nk = extent[5] - extent[4] + 1;
  let bounds: Extent3D | undefined;

  const scanRow = (rowStart: number, j: number, k: number) => {
    for (let index = 0; index < ni; index += 1) {
      if (scalars[rowStart + index] !== labelValue) continue;
      const i = extent[0] + index;
      if (bounds) growExtent(bounds, i, j, k);
      else bounds = [i, i, j, j, k, k];
    }
  };

  for (let row = 0; row < nj * nk; row += 1) {
    scanRow(row * ni, extent[2] + (row % nj), extent[4] + Math.floor(row / nj));
  }

  return bounds ?? emptyExtent();
}

export function extentUnion(a: Extent3D, b: Extent3D): Extent3D {
  return [
    Math.min(a[0], b[0]),
    Math.max(a[1], b[1]),
    Math.min(a[2], b[2]),
    Math.max(a[3], b[3]),
    Math.min(a[4], b[4]),
    Math.max(a[5], b[5]),
  ];
}

/** `extent` widened by `padding` voxels on every face. */
export function padExtent(extent: Extent3D, padding: number): Extent3D {
  return [
    extent[0] - padding,
    extent[1] + padding,
    extent[2] - padding,
    extent[3] + padding,
    extent[4] - padding,
    extent[5] + padding,
  ];
}

/** The part of `extent` inside `bounds`; empty when they do not overlap. */
export function clipExtent(extent: Extent3D, bounds: Extent3D): Extent3D {
  return [
    Math.max(extent[0], bounds[0]),
    Math.min(extent[1], bounds[1]),
    Math.max(extent[2], bounds[2]),
    Math.min(extent[3], bounds[3]),
    Math.max(extent[4], bounds[4]),
    Math.min(extent[5], bounds[5]),
  ];
}

/** The extent of an image's whole index space. */
export function fullExtent(dimensions: number[] | Int32Array): Extent3D {
  return [0, dimensions[0] - 1, 0, dimensions[1] - 1, 0, dimensions[2] - 1];
}

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

const parseRgbColor = (value: string): RGBAColor | undefined => {
  const match = RGB_COLOR.exec(value);
  if (!match) return undefined;
  const args = splitArgs(match[1]);
  if (args.length < 3) return undefined;
  const channels = args.slice(0, 3).map(toChannel);
  if (channels.some((channel) => !Number.isFinite(channel))) return undefined;
  return [...channels, toAlpha(args[3])] as RGBAColor;
};

const parseHslColor = (value: string): RGBAColor | undefined => {
  const match = HSL_COLOR.exec(value);
  if (!match) return undefined;
  const args = splitArgs(match[1]);
  if (args.length < 3) return undefined;
  const hue = Number(args[0].replace(/deg$/, ''));
  const sat = Number(args[1].replace(/%$/, '')) / 100;
  const light = Number(args[2].replace(/%$/, '')) / 100;
  if (![hue, sat, light].every(Number.isFinite)) return undefined;
  return [...hslToRGB(hue, sat, light), toAlpha(args[3])] as RGBAColor;
};

/** Parses hex, named, rgb(a), and hsl(a) CSS colors. */
export function tryCssColorToRGBA(css: string): RGBAColor | undefined {
  const value = css.trim().toLowerCase();
  if (value === 'transparent') return [0, 0, 0, 0];

  const named = NAMED_COLORS.get(value);
  if (named) return [...named, 255] as RGBAColor;

  const hex = HEX_COLOR.exec(value)?.[1];
  if (hex) return hexaToRGBA(expandShorthandHex(hex));

  return parseRgbColor(value) ?? parseHslColor(value);
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
