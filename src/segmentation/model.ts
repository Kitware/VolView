import type { Extent3D } from '@/src/segmentation/geometry';
import type { ProcessingResultSource } from '@/src/types';
import type { RGBAColor, TypedArray } from '@kitware/vtk.js/types';

import type vtkLabelMap from '@/src/vtk/LabelMap';

/** A fresh segmentation tints the anatomy under it rather than hiding it. */
export const DEFAULT_SEGMENTATION_FILL_OPACITY = 0.3;

export type LabelmapBinding = {
  /**
   * This mask's voxels, and no other segment's. Held raw: a vtk object must
   * not be proxied, so every writer of a binding marks it.
   */
  image: vtkLabelMap;
  extent: Extent3D; // the mask's own bounds, in parent image index space
  /** Reaches the saved archive's entry path, so a round trip keeps it. */
  name: string;
  source?: ProcessingResultSource;
};

/**
 * One image's mask for one segment type. Its id is its own, distinct from the
 * type id: everything the user sees or sets, visibility and lock included,
 * lives on the type, so this record is storage and nothing else.
 */
export type SegmentMask = {
  id: string;
  segmentId: string;
  representations: {
    // absent until voxels are allocated
    labelmap?: LabelmapBinding;
  };
};

export const LABELMAP_BACKGROUND_VALUE = 0;

export const makeDefaultSegmentName = (value: number) => `Segment ${value}`;

/**
 * One mask's label descriptor, derived from the segment it delineates.
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
  image(): vtkLabelMap;
  /** Live mask buffer. Writers publish changes through apply() or image().modified(). */
  scalars(): TypedArray;
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
  binding(): LabelmapBinding | undefined;
  /** Allocates storage if needed and returns the binding. Idempotent. */
  materialize(): LabelmapBinding;
};

/** Segments in display order. `order` is the authority, `segments` the store. */
export function listMasks(segmentation: Segmentation) {
  return segmentation.order.map((id) => segmentation.masks[id]);
}

/** Aimed writes clear unlocked neighbors; sweeps only grow into unclaimed voxels. */
export type VoxelGesture = 'aimed' | 'sweep';
