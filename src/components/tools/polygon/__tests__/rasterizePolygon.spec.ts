import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import type { Vector3 } from '@kitware/vtk.js/types';

import { rasterizePolygon } from '@/src/components/tools/polygon/rasterizeTarget';
import { useSegmentTypeStore } from '@/src/store/segmentTypes';
import { listSegments } from '@/src/types/segmentation';
import {
  addSegment,
  extentOf,
  labelValueOf,
  maskValueAt,
  seatImage,
  seedVoxel,
  store,
  typeOf,
  type Index3,
  lockSegment,
} from '@/src/store/__tests__/segmentMaskFixtures';

// ---------------------------------------------------------------------------
// Rasterizing a polygon into a bounded mask. The write lives outside
// PolygonTool.vue so it can be tested: the component owns the view, not the
// voxels. The mask grows to hold the polygon before `fillPoly` runs (a mask
// that does not reach the polygon silently swallows every pixel), and the
// filled voxels are cleared in the other UNLOCKED segments of the image. A
// locked one keeps its voxels, so the two segments overlap there.
//
// Unit spacing and a zero origin make world points index points, and an
// identity direction maps the Axial view axis to K.
// ---------------------------------------------------------------------------

const DIMENSIONS: Index3 = [6, 6, 2];

// fillPoly fills i in 1..4 and j in 2..4 for this square.
const SQUARE: Vector3[] = [
  [1, 1, 0],
  [4, 1, 0],
  [4, 4, 0],
  [1, 4, 0],
];

const rasterize = (typeId: string | undefined, points = SQUARE, slice = 0) =>
  rasterizePolygon({
    imageId: 'img-1',
    typeId,
    points,
    slice,
    viewAxis: 'Axial',
  });

/** What a polygon carries: the type, not the record it lands in. */
const rasterizeInto = (
  segmentId: string | undefined,
  points = SQUARE,
  slice = 0
) => rasterize(segmentId && typeOf(segmentId), points, slice);

const types = () => useSegmentTypeStore().types;

const segmentNamesOf = (imageId: string) =>
  listSegments(store().getSegmentationForImage(imageId)!).map(
    (segment) => types().appearanceOf(segment.typeId).name
  );

describe('rasterizing a polygon into a bounded mask', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatImage('img-1', { dimensions: DIMENSIONS });
  });

  it('grows the mask to hold the polygon and fills it', () => {
    const segmentId = addSegment('img-1', 'Tumor');

    rasterizeInto(segmentId);

    const labelValue = labelValueOf(segmentId);
    expect(maskValueAt(segmentId, [2, 3, 0])).toBe(labelValue);
    expect(maskValueAt(segmentId, [3, 3, 0])).toBe(labelValue);
    const extent = extentOf(segmentId)!;
    expect(extent[0]).toBeLessThanOrEqual(1);
    expect(extent[1]).toBeGreaterThanOrEqual(4);
    expect(extent[3]).toBeGreaterThanOrEqual(4);
    // One slice was drawn on, so one slice is covered.
    expect([extent[4], extent[5]]).toEqual([0, 0]);
  });

  it('leaves everything outside the polygon alone', () => {
    const segmentId = addSegment('img-1', 'Tumor');

    rasterizeInto(segmentId);

    expect(maskValueAt(segmentId, [0, 0, 0])).toBeFalsy();
    expect(maskValueAt(segmentId, [5, 5, 0])).toBeFalsy();
    expect(maskValueAt(segmentId, [2, 3, 1])).toBeFalsy();
  });

  it('clears the filled voxels in another segment’s mask', () => {
    const neighbor = addSegment('img-1', 'Neighbour');
    seedVoxel(neighbor, [2, 3, 0]);
    seedVoxel(neighbor, [0, 0, 0]);
    const segmentId = addSegment('img-1', 'Tumor');

    rasterizeInto(segmentId);

    expect(maskValueAt(neighbor, [2, 3, 0])).toBe(0);
    expect(maskValueAt(neighbor, [0, 0, 0])).toBe(labelValueOf(neighbor));
  });

  it('shares the filled voxels with a locked neighbour', () => {
    const locked = addSegment('img-1', 'Locked');
    const unlocked = addSegment('img-1', 'Unlocked');
    seedVoxel(locked, [2, 3, 0]);
    seedVoxel(unlocked, [2, 3, 0]);
    lockSegment(locked, true);
    const segmentId = addSegment('img-1', 'Tumor');

    rasterizeInto(segmentId);

    expect(maskValueAt(locked, [2, 3, 0])).toBe(labelValueOf(locked));
    expect(maskValueAt(unlocked, [2, 3, 0])).toBe(0);
    expect(maskValueAt(segmentId, [2, 3, 0])).toBe(labelValueOf(segmentId));
  });

  it('refuses a locked segment and leaves every mask as it was', () => {
    const neighbour = addSegment('img-1', 'Neighbour');
    seedVoxel(neighbour, [2, 3, 0]);
    const segmentId = addSegment('img-1', 'Tumor');
    lockSegment(segmentId, true);

    const result = rasterizeInto(segmentId);

    // Refused: the type is named back, but nothing was written into a record.
    expect(result.segmentId).toBeUndefined();
    expect(result.typeId).toBe(typeOf(segmentId));
    expect(maskValueAt(segmentId, [2, 3, 0])).toBeFalsy();
    // The clearer never ran, so the neighbour keeps what a fill would take.
    expect(maskValueAt(neighbour, [2, 3, 0])).toBe(labelValueOf(neighbour));
  });

  it('keeps an earlier polygon when a later one grows the mask', () => {
    const segmentId = addSegment('img-1', 'Tumor');

    rasterizeInto(segmentId);
    rasterizeInto(
      segmentId,
      [
        [1, 1, 1],
        [4, 1, 1],
        [4, 4, 1],
        [1, 4, 1],
      ],
      1
    );

    const labelValue = labelValueOf(segmentId);
    expect(maskValueAt(segmentId, [2, 3, 0])).toBe(labelValue);
    expect(maskValueAt(segmentId, [2, 3, 1])).toBe(labelValue);
  });

  it('stays inside the parent image for a polygon that overhangs it', () => {
    const segmentId = addSegment('img-1', 'Tumor');

    expect(() =>
      rasterizeInto(segmentId, [
        [-2, -2, 0],
        [2, -2, 0],
        [2, 2, 0],
        [-2, 2, 0],
      ])
    ).not.toThrow();

    const extent = extentOf(segmentId)!;
    expect(extent[0]).toBe(0);
    expect(extent[2]).toBe(0);
    expect(maskValueAt(segmentId, [1, 1, 0])).toBe(labelValueOf(segmentId));
  });

  it('rasterizes into a segment it resolves when the polygon carries none', () => {
    const segmentId = rasterize(undefined).segmentId!;

    const segmentation = store().getSegmentationForImage('img-1')!;
    expect(segmentation.order).toEqual([segmentId]);
    expect(maskValueAt(segmentId, [2, 3, 0])).toBe(labelValueOf(segmentId));
  });

  it('rasterizes into the type the polygon names, not the selected one', () => {
    const tumor = types().addType({ name: 'Tumor' });
    const node = types().addType({ name: 'Node' });
    // The user picks another type between placing the polygon and rasterizing
    // it; the polygon still carries the type it was drawn with.
    types().selectType(node);

    const segmentId = rasterize(tumor).segmentId!;

    expect(typeOf(segmentId)).toBe(tumor);
    expect(segmentNamesOf('img-1')).toEqual(['Tumor']);
    expect(maskValueAt(segmentId, [2, 3, 0])).toBe(labelValueOf(segmentId));

    const nextEdit = store().resolveEditTarget('img-1');
    expect(typeOf(nextEdit)).toBe(node);
    expect(segmentNamesOf('img-1')).toEqual(['Tumor', 'Node']);
  });

  it('rasterizes into the record its type already has here', () => {
    const tumor = types().addType({ name: 'Tumor' });

    const first = rasterize(tumor);
    const second = rasterize(tumor, SQUARE, 1);

    expect(second.segmentId).toBe(first.segmentId);
    expect(segmentNamesOf('img-1')).toEqual(['Tumor']);
  });

  it('leaves the rasterized record for the next paint edit', () => {
    const tumor = types().addType({ name: 'Tumor' });

    const rasterized = rasterize(tumor).segmentId!;
    const painted = store().resolveEditTarget('img-1');

    expect(painted).toBe(rasterized);
    expect(types().selectedTypeId.value).toBe(tumor);
    expect(segmentNamesOf('img-1')).toEqual(['Tumor']);
  });

  it('rasterizes into the type it was given, not the selected one', () => {
    const active = addSegment('img-1', 'Active');
    types().selectType(typeOf(active));
    const named = addSegment('img-1', 'Named');

    const result = rasterizeInto(named);

    expect(result.segmentId).toBe(named);
    expect(maskValueAt(named, [2, 3, 0])).toBe(labelValueOf(named));
    expect(maskValueAt(active, [2, 3, 0])).toBeFalsy();
  });
});
