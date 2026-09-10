import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import type { Vector3 } from '@kitware/vtk.js/types';

import { rasterizePolygon } from '@/src/components/tools/polygon/rasterizeTarget';
import { useSegmentStore } from '@/src/store/segments';
import { listMasks } from '@/src/types/segmentation';
import {
  addMask,
  extentOf,
  labelValueOf,
  maskValueAt,
  seatImage,
  seedVoxel,
  store,
  segmentOfMask,
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

const rasterize = (segmentId: string | undefined, points = SQUARE, slice = 0) =>
  rasterizePolygon({
    imageId: 'img-1',
    segmentId,
    points,
    slice,
    viewAxis: 'Axial',
  });

/** What a polygon carries: the type, not the record it lands in. */
const rasterizeInto = (
  maskId: string | undefined,
  points = SQUARE,
  slice = 0
) => rasterize(maskId && segmentOfMask(maskId), points, slice);

const segments = () => useSegmentStore().segments;

const segmentNamesOf = (imageId: string) =>
  listMasks(store().getSegmentationForImage(imageId)!).map(
    (segment) => segments().appearanceOf(segment.segmentId).name
  );

describe('rasterizing a polygon into a bounded mask', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatImage('img-1', { dimensions: DIMENSIONS });
  });

  it('grows the mask to hold the polygon and fills it', () => {
    const maskId = addMask('img-1', 'Tumor');

    rasterizeInto(maskId);

    const labelValue = labelValueOf(maskId);
    expect(maskValueAt(maskId, [2, 3, 0])).toBe(labelValue);
    expect(maskValueAt(maskId, [3, 3, 0])).toBe(labelValue);
    const extent = extentOf(maskId)!;
    expect(extent[0]).toBeLessThanOrEqual(1);
    expect(extent[1]).toBeGreaterThanOrEqual(4);
    expect(extent[3]).toBeGreaterThanOrEqual(4);
    // One slice was drawn on, so one slice is covered.
    expect([extent[4], extent[5]]).toEqual([0, 0]);
  });

  it('leaves everything outside the polygon alone', () => {
    const maskId = addMask('img-1', 'Tumor');

    rasterizeInto(maskId);

    expect(maskValueAt(maskId, [0, 0, 0])).toBeFalsy();
    expect(maskValueAt(maskId, [5, 5, 0])).toBeFalsy();
    expect(maskValueAt(maskId, [2, 3, 1])).toBeFalsy();
  });

  it('clears the filled voxels in another segment’s mask', () => {
    const neighbor = addMask('img-1', 'Neighbour');
    seedVoxel(neighbor, [2, 3, 0]);
    seedVoxel(neighbor, [0, 0, 0]);
    const maskId = addMask('img-1', 'Tumor');

    rasterizeInto(maskId);

    expect(maskValueAt(neighbor, [2, 3, 0])).toBe(0);
    expect(maskValueAt(neighbor, [0, 0, 0])).toBe(labelValueOf(neighbor));
  });

  it('shares the filled voxels with a locked neighbour', () => {
    const locked = addMask('img-1', 'Locked');
    const unlocked = addMask('img-1', 'Unlocked');
    seedVoxel(locked, [2, 3, 0]);
    seedVoxel(unlocked, [2, 3, 0]);
    lockSegment(locked, true);
    const maskId = addMask('img-1', 'Tumor');

    rasterizeInto(maskId);

    expect(maskValueAt(locked, [2, 3, 0])).toBe(labelValueOf(locked));
    expect(maskValueAt(unlocked, [2, 3, 0])).toBe(0);
    expect(maskValueAt(maskId, [2, 3, 0])).toBe(labelValueOf(maskId));
  });

  it('publishes each changed neighbor once before returning from a fill', () => {
    const neighbors = ['First', 'Second', 'Locked', 'Background'].map(
      (name) => {
        const id = addMask('img-1', name);
        const voxels = store().maskVoxels(id);
        voxels.materialize();
        voxels.ensureContains([0, 5, 0, 5, 0, 1]);
        if (name !== 'Background') voxels.scalars().fill(1);
        if (name === 'Locked') lockSegment(id, true);
        const modified = vi.fn();
        voxels.image().onModified(modified);
        return { id, modified };
      }
    );
    const target = addMask('img-1', 'Target');

    rasterizeInto(target);

    expect(neighbors.map(({ modified }) => modified.mock.calls.length)).toEqual(
      [1, 1, 0, 0]
    );
    expect(neighbors.map(({ id }) => maskValueAt(id, [2, 3, 0]))).toEqual([
      0, 0, 1, 0,
    ]);
    // Repeating unchanged writes must not publish another sibling event.
    rasterizeInto(target);
    expect(neighbors[0].modified).toHaveBeenCalledTimes(1);

    rasterizeInto(target, SQUARE, 1);
    expect(neighbors.map(({ modified }) => modified.mock.calls.length)).toEqual(
      [2, 2, 0, 0]
    );
    expect(maskValueAt(target, [2, 3, 1])).toBe(1);
    expect(maskValueAt(neighbors[0].id, [0, 0, 0])).toBe(1);
  });

  it('refuses a locked segment and leaves every mask as it was', () => {
    const neighbour = addMask('img-1', 'Neighbour');
    seedVoxel(neighbour, [2, 3, 0]);
    const maskId = addMask('img-1', 'Tumor');
    lockSegment(maskId, true);

    const result = rasterizeInto(maskId);

    // Refused: the type is named back, but nothing was written into a record.
    expect(result.maskId).toBeUndefined();
    expect(result.segmentId).toBe(segmentOfMask(maskId));
    expect(maskValueAt(maskId, [2, 3, 0])).toBeFalsy();
    // The clearer never ran, so the neighbour keeps what a fill would take.
    expect(maskValueAt(neighbour, [2, 3, 0])).toBe(labelValueOf(neighbour));
  });

  it('keeps an earlier polygon when a later one grows the mask', () => {
    const maskId = addMask('img-1', 'Tumor');

    rasterizeInto(maskId);
    rasterizeInto(
      maskId,
      [
        [1, 1, 1],
        [4, 1, 1],
        [4, 4, 1],
        [1, 4, 1],
      ],
      1
    );

    const labelValue = labelValueOf(maskId);
    expect(maskValueAt(maskId, [2, 3, 0])).toBe(labelValue);
    expect(maskValueAt(maskId, [2, 3, 1])).toBe(labelValue);
  });

  it('stays inside the parent image for a polygon that overhangs it', () => {
    const maskId = addMask('img-1', 'Tumor');

    expect(() =>
      rasterizeInto(maskId, [
        [-2, -2, 0],
        [2, -2, 0],
        [2, 2, 0],
        [-2, 2, 0],
      ])
    ).not.toThrow();

    const extent = extentOf(maskId)!;
    expect(extent[0]).toBe(0);
    expect(extent[2]).toBe(0);
    expect(maskValueAt(maskId, [1, 1, 0])).toBe(labelValueOf(maskId));
  });

  it('rasterizes into a segment it resolves when the polygon carries none', () => {
    const maskId = rasterize(undefined).maskId!;

    const segmentation = store().getSegmentationForImage('img-1')!;
    expect(segmentation.order).toEqual([maskId]);
    expect(maskValueAt(maskId, [2, 3, 0])).toBe(labelValueOf(maskId));
  });

  it('rasterizes into the type the polygon names, not the selected one', () => {
    const tumor = segments().addSegment({ name: 'Tumor' });
    const node = segments().addSegment({ name: 'Node' });
    // The user picks another type between placing the polygon and rasterizing
    // it; the polygon still carries the type it was drawn with.
    segments().selectSegment(node);

    const maskId = rasterize(tumor).maskId!;

    expect(segmentOfMask(maskId)).toBe(tumor);
    expect(segmentNamesOf('img-1')).toEqual(['Tumor']);
    expect(maskValueAt(maskId, [2, 3, 0])).toBe(labelValueOf(maskId));

    const nextEdit = store().resolveEditTarget('img-1');
    expect(segmentOfMask(nextEdit)).toBe(node);
    expect(segmentNamesOf('img-1')).toEqual(['Tumor', 'Node']);
  });

  it('rasterizes into the record its type already has here', () => {
    const tumor = segments().addSegment({ name: 'Tumor' });

    const first = rasterize(tumor);
    const second = rasterize(tumor, SQUARE, 1);

    expect(second.maskId).toBe(first.maskId);
    expect(segmentNamesOf('img-1')).toEqual(['Tumor']);
  });

  it('leaves the rasterized record for the next paint edit', () => {
    const tumor = segments().addSegment({ name: 'Tumor' });

    const rasterized = rasterize(tumor).maskId!;
    const painted = store().resolveEditTarget('img-1');

    expect(painted).toBe(rasterized);
    expect(segments().selectedSegmentId.value).toBe(tumor);
    expect(segmentNamesOf('img-1')).toEqual(['Tumor']);
  });

  it('rasterizes into the type it was given, not the selected one', () => {
    const active = addMask('img-1', 'Active');
    segments().selectSegment(segmentOfMask(active));
    const named = addMask('img-1', 'Named');

    const result = rasterizeInto(named);

    expect(result.maskId).toBe(named);
    expect(maskValueAt(named, [2, 3, 0])).toBe(labelValueOf(named));
    expect(maskValueAt(active, [2, 3, 0])).toBeFalsy();
  });
});
