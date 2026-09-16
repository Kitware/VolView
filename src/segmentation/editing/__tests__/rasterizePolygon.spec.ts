import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import type { Vector3 } from '@kitware/vtk.js/types';

import {
  rasterizePolygon,
  rasterizeTargetDisabledReason,
} from '@/src/segmentation/editing/rasterizePolygon';
import { useMessageStore } from '@/src/store/messages';
import { useSegmentStore } from '@/src/segmentation/segments';
import { listMasks } from '@/src/segmentation/model';
import {
  addMask,
  extentOf,
  maskValueAt,
  markedVoxels,
  seatImage,
  seedVoxel,
  store,
  segmentOfMask,
  type Index3,
  lockSegment,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';
import { SEGMENT_VALUE } from '@/src/segmentation/masks/labelValue';

// Unit spacing and a zero origin make world points index points, Axial on K.

const DIMENSIONS: Index3 = [6, 6, 2];

// fillPoly fills i in 1..4 and j in 2..4 for this square.
const SQUARE: Vector3[] = [
  [1, 1, 0],
  [4, 1, 0],
  [4, 4, 0],
  [1, 4, 0],
];

// fillPoly fills i in 1..5 on rows j 2..3 and i in 1..3 on rows j 4..5.
const L_SHAPE: Vector3[] = [
  [1, 1, 0],
  [5, 1, 0],
  [5, 3, 0],
  [3, 3, 0],
  [3, 5, 0],
  [1, 5, 0],
];
const L_NOTCH: Index3[] = [
  [4, 4, 0],
  [5, 4, 0],
  [4, 5, 0],
  [5, 5, 0],
];

const rasterize = (segmentId: string | undefined, points = SQUARE, slice = 0) =>
  rasterizePolygon({
    imageId: 'img-1',
    segmentId,
    points,
    slice,
    viewAxis: 'Axial',
  });

/** What a polygon carries: the segment, not the mask it lands in. */
const rasterizeInto = (
  maskId: string | undefined,
  points = SQUARE,
  slice = 0
) => rasterize(maskId && segmentOfMask(maskId), points, slice);

const segments = () => useSegmentStore().segments;

const UNLOCK_REASON = 'Unlock this segment to rasterize into it';

const segmentNamesOf = (imageId: string) =>
  listMasks(store().getSegmentationForImage(imageId)!).map(
    (mask) => segments().appearanceOf(mask.segmentId).name
  );

describe('rasterizing a polygon into a bounded mask', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatImage('img-1', { dimensions: DIMENSIONS });
  });

  it('grows the mask to hold the polygon and fills it', () => {
    const maskId = addMask('img-1', 'Tumor');

    rasterizeInto(maskId);
    expect(maskValueAt(maskId, [2, 3, 0])).toBe(SEGMENT_VALUE);
    expect(maskValueAt(maskId, [3, 3, 0])).toBe(SEGMENT_VALUE);
    const extent = extentOf(maskId)!;
    expect(extent[0]).toBeLessThanOrEqual(1);
    expect(extent[1]).toBeGreaterThanOrEqual(4);
    expect(extent[3]).toBeGreaterThanOrEqual(4);
    expect([extent[4], extent[5]]).toEqual([0, 0]);
  });

  it('leaves everything outside the polygon alone', () => {
    const maskId = addMask('img-1', 'Tumor');

    rasterizeInto(maskId, L_SHAPE);

    // The notch lies inside the mask's box, so each probe reads a stored 0.
    expect(L_NOTCH.map((index) => maskValueAt(maskId, index))).toEqual([
      0, 0, 0, 0,
    ]);
    expect(markedVoxels(maskId)).toHaveLength(16);
  });

  it("clears the filled voxels in another segment's mask", () => {
    const neighbor = addMask('img-1', 'Neighbor');
    seedVoxel(neighbor, [2, 3, 0]);
    seedVoxel(neighbor, [0, 0, 0]);
    const maskId = addMask('img-1', 'Tumor');

    rasterizeInto(maskId);

    expect(maskValueAt(neighbor, [2, 3, 0])).toBe(0);
    expect(maskValueAt(neighbor, [0, 0, 0])).toBe(SEGMENT_VALUE);
  });

  it('fills around the voxels a locked neighbor holds', () => {
    const locked = addMask('img-1', 'Locked');
    const unlocked = addMask('img-1', 'Unlocked');
    seedVoxel(locked, [2, 3, 0]);
    seedVoxel(unlocked, [2, 3, 0]);
    seedVoxel(unlocked, [3, 3, 0]);
    lockSegment(locked, true);
    const maskId = addMask('img-1', 'Tumor');

    rasterizeInto(maskId);

    expect(maskValueAt(locked, [2, 3, 0])).toBe(SEGMENT_VALUE);
    expect(maskValueAt(unlocked, [2, 3, 0])).toBe(SEGMENT_VALUE);
    expect(maskValueAt(maskId, [2, 3, 0])).toBeFalsy();
    expect(maskValueAt(unlocked, [3, 3, 0])).toBe(0);
    expect(maskValueAt(maskId, [3, 3, 0])).toBe(SEGMENT_VALUE);
  });

  it('deletes a neighbor the fill takes every voxel from', () => {
    const neighbor = addMask('img-1', 'Neighbor');
    seedVoxel(neighbor, [2, 3, 0]);
    const maskId = addMask('img-1', 'Tumor');

    rasterizeInto(maskId);

    expect(store().maskExists(neighbor)).toBe(false);
    expect(maskValueAt(maskId, [2, 3, 0])).toBe(SEGMENT_VALUE);
  });

  it('deletes the mask of a fill that lands nowhere and names none', () => {
    const locked = addMask('img-1', 'Locked');
    const voxels = store().maskVoxels(locked);
    voxels.materialize();
    voxels.ensureContains([0, 5, 0, 5, 0, 1]);
    voxels.scalars().fill(SEGMENT_VALUE);
    lockSegment(locked, true);
    const tumor = segments().addSegment({ name: 'Tumor' });

    const result = rasterize(tumor);

    expect(result).toEqual({ segmentId: tumor, maskId: undefined });
    expect(store().maskFor('img-1', tumor)).toBeUndefined();
    expect(markedVoxels(locked)).toHaveLength(72);
  });

  it('shares the filled voxels with every neighbor while overlap is allowed', () => {
    const locked = addMask('img-1', 'Locked');
    const unlocked = addMask('img-1', 'Unlocked');
    seedVoxel(locked, [2, 3, 0]);
    seedVoxel(unlocked, [3, 3, 0]);
    lockSegment(locked, true);
    const maskId = addMask('img-1', 'Tumor');
    store().allowOverlap = true;

    rasterizeInto(maskId);

    expect(maskValueAt(locked, [2, 3, 0])).toBe(SEGMENT_VALUE);
    expect(maskValueAt(unlocked, [3, 3, 0])).toBe(SEGMENT_VALUE);
    expect(maskValueAt(maskId, [2, 3, 0])).toBe(SEGMENT_VALUE);
    expect(maskValueAt(maskId, [3, 3, 0])).toBe(SEGMENT_VALUE);
  });

  it('publishes each changed neighbor once before returning from a fill', () => {
    const neighbors = ['First', 'Second', 'Locked', 'Background'].map(
      (name) => {
        const id = addMask('img-1', name);
        const voxels = store().maskVoxels(id);
        voxels.materialize();
        voxels.ensureContains([0, 5, 0, 5, 0, 1]);
        if (name === 'First' || name === 'Second')
          voxels.scalars().fill(SEGMENT_VALUE);
        // Held inside the polygon, so the fill goes around it.
        if (name === 'Locked') {
          seedVoxel(id, [1, 2, 0]);
          lockSegment(id, true);
        }
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
      0, 0, 0, 0,
    ]);
    // Repeating unchanged writes must not publish another sibling event.
    rasterizeInto(target);
    expect(neighbors[0].modified).toHaveBeenCalledTimes(1);

    rasterizeInto(target, SQUARE, 1);
    expect(neighbors.map(({ modified }) => modified.mock.calls.length)).toEqual(
      [2, 2, 0, 0]
    );
    expect(maskValueAt(target, [2, 3, 1])).toBe(SEGMENT_VALUE);
    expect(maskValueAt(neighbors[0].id, [0, 0, 0])).toBe(SEGMENT_VALUE);
  });

  it('creates nothing for a polygon that covers no voxel', () => {
    // Resolving the target mints the record, its segmentation and its
    // storage, so a polygon with nothing to fill is answered before that.
    const empty = rasterize(undefined, []);
    const outside = rasterize(undefined, [
      [-4, -4, 0],
      [-2, -4, 0],
      [-2, -2, 0],
      [-4, -2, 0],
    ]);

    expect(empty).toEqual({ segmentId: undefined, maskId: undefined });
    expect(outside).toEqual({ segmentId: undefined, maskId: undefined });
    expect(store().getSegmentationForImage('img-1')).toBeUndefined();
  });

  it('refuses a locked segment and leaves every mask as it was', () => {
    const neighbor = addMask('img-1', 'Neighbor');
    seedVoxel(neighbor, [2, 3, 0]);
    const maskId = addMask('img-1', 'Tumor');
    lockSegment(maskId, true);

    const result = rasterizeInto(maskId);

    // Refused: the segment is named back, but nothing was written into a record.
    expect(result.maskId).toBeUndefined();
    expect(result.segmentId).toBe(segmentOfMask(maskId));
    expect(maskValueAt(maskId, [2, 3, 0])).toBeFalsy();
    // The clearer never ran, so the neighbor keeps what a fill would take.
    expect(maskValueAt(neighbor, [2, 3, 0])).toBe(SEGMENT_VALUE);
    expect(store().getMask(maskId).representations.labelmap).toBeUndefined();
    expect(useMessageStore().messages.map(({ title }) => title)).toContain(
      'Cannot rasterize into a locked segment'
    );
    expect(rasterizeTargetDisabledReason(segmentOfMask(maskId))).toBe(
      UNLOCK_REASON
    );
  });

  it('names the locked first segment for a polygon carrying none, without allocating it', () => {
    const first = addMask('img-1', 'First');
    lockSegment(first, true);

    expect(rasterizeTargetDisabledReason('')).toBe(UNLOCK_REASON);
    expect(store().getMask(first).representations.labelmap).toBeUndefined();
  });

  it('falls back to the selected segment when the polygon names a deleted one', () => {
    const stale = segmentOfMask(addMask('img-1', 'Deleted'));
    const fallback = addMask('img-1', 'Selected');
    segments().selectSegment(segmentOfMask(fallback));
    segments().deleteSegment(stale);
    lockSegment(fallback, true);

    expect(rasterizeTargetDisabledReason(stale)).toBe(UNLOCK_REASON);
    expect(rasterizeTargetDisabledReason('')).toBe(UNLOCK_REASON);

    lockSegment(fallback, false);
    expect(rasterizeTargetDisabledReason(stale)).toBe('');
    expect(rasterize(stale)).toEqual({
      segmentId: segmentOfMask(fallback),
      maskId: fallback,
    });
    expect(maskValueAt(fallback, [2, 3, 0])).toBe(SEGMENT_VALUE);
  });

  it('mints a segment when the polygon names the only one, since deleted', () => {
    const deleted = segments().addSegment({ name: 'Tumor' });
    segments().deleteSegment(deleted);

    const result = rasterize(deleted);

    expect(result.segmentId).not.toBe(deleted);
    expect(store().getSegmentationForImage('img-1')!.order).toEqual([
      result.maskId,
    ]);
    expect(maskValueAt(result.maskId!, [2, 3, 0])).toBe(SEGMENT_VALUE);
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
    expect(maskValueAt(maskId, [2, 3, 0])).toBe(SEGMENT_VALUE);
    expect(maskValueAt(maskId, [2, 3, 1])).toBe(SEGMENT_VALUE);
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
    expect(maskValueAt(maskId, [1, 1, 0])).toBe(SEGMENT_VALUE);
  });

  it('rasterizes into a segment it resolves when the polygon carries none', () => {
    const maskId = rasterize(undefined).maskId!;

    const segmentation = store().getSegmentationForImage('img-1')!;
    expect(segmentation.order).toEqual([maskId]);
    expect(maskValueAt(maskId, [2, 3, 0])).toBe(SEGMENT_VALUE);
  });

  it('rasterizes into the segment the polygon names, not the selected one', () => {
    const tumor = segments().addSegment({ name: 'Tumor' });
    const node = segments().addSegment({ name: 'Node' });
    // The user picks another segment between placing the polygon and rasterizing
    // it; the polygon still carries the segment it was drawn with.
    segments().selectSegment(node);

    const maskId = rasterize(tumor).maskId!;

    expect(segmentOfMask(maskId)).toBe(tumor);
    expect(segmentNamesOf('img-1')).toEqual(['Tumor']);
    expect(maskValueAt(maskId, [2, 3, 0])).toBe(SEGMENT_VALUE);

    const nextEdit = store().resolveEditTarget('img-1');
    expect(segmentOfMask(nextEdit)).toBe(node);
    expect(segmentNamesOf('img-1')).toEqual(['Tumor', 'Node']);
  });

  it('rasterizes into the record its segment already has here', () => {
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
});

// Integer-vertex triangles put edges on pixel centers, where allocation must not decide.

const GRID: Index3 = [40, 40, 1];
const GRID_EXTENT = [0, 39, 0, 39, 0, 0] as const;

const TRIANGLES: Vector3[][] = [
  [
    [18, 23, 0],
    [27, 6, 0],
    [5, 28, 0],
  ],
  [
    [2, 2, 0],
    [30, 2, 0],
    [2, 30, 0],
  ],
  [
    [10, 5, 0],
    [35, 20, 0],
    [6, 33, 0],
  ],
  [
    [7, 31, 0],
    [33, 9, 0],
    [20, 36, 0],
  ],
  [
    [1, 17, 0],
    [38, 4, 0],
    [22, 29, 0],
  ],
  [
    [12, 1, 0],
    [29, 25, 0],
    [3, 38, 0],
  ],
];

describe('rasterizing a polygon whatever the mask already holds', () => {
  const fillOn = (imageId: string, points: Vector3[], grown: boolean) => {
    const maskId = addMask(imageId, 'Tumor');
    const voxels = store().maskVoxels(maskId);
    voxels.materialize();
    if (grown) voxels.ensureContains([...GRID_EXTENT]);
    rasterizePolygon({
      imageId,
      segmentId: segmentOfMask(maskId),
      points,
      slice: 0,
      viewAxis: 'Axial',
    });
    return markedVoxels(maskId);
  };

  it('fills the same parent voxels into a fresh and an image-sized mask', async () => {
    const fills = [];
    for (const points of TRIANGLES) {
      setActivePinia(createPinia());
      // Separate images so neither fill can claim the other's voxels.
      await seatImage('fresh', { dimensions: GRID });
      await seatImage('grown', { dimensions: GRID });
      fills.push({
        fresh: fillOn('fresh', points, false),
        grown: fillOn('grown', points, true),
      });
    }

    expect(fills.map(({ fresh }) => fresh)).toEqual(
      fills.map(({ grown }) => grown)
    );
    expect(fills.every(({ fresh }) => fresh!.length > 0)).toBe(true);
  });
});
