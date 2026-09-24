import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import type { Vector3 } from '@kitware/vtk.js/types';

import { rasterizePolygon } from '@/src/segmentation/editing/rasterizePolygon';
import { useSegmentStore } from '@/src/segmentation/segments';
import { listMasks } from '@/src/segmentation/model';
import {
  addMask,
  extentOf,
  labelValueOf,
  maskValueAt,
  markedVoxels,
  seatImage,
  seedVoxel,
  store,
  segmentOfMask,
  type Index3,
  lockSegment,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';

// ---------------------------------------------------------------------------
// The mask grows to hold the polygon before `fillPoly` runs (a mask that does
// not reach the polygon silently swallows every pixel), and the filled voxels
// are cleared in the other UNLOCKED segments of the image. A locked one keeps
// its voxels and the fill goes around them.
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

  it('fills around the voxels a locked neighbour holds', () => {
    const locked = addMask('img-1', 'Locked');
    const unlocked = addMask('img-1', 'Unlocked');
    seedVoxel(locked, [2, 3, 0]);
    seedVoxel(unlocked, [2, 3, 0]);
    seedVoxel(unlocked, [3, 3, 0]);
    lockSegment(locked, true);
    const maskId = addMask('img-1', 'Tumor');

    rasterizeInto(maskId);

    expect(maskValueAt(locked, [2, 3, 0])).toBe(labelValueOf(locked));
    expect(maskValueAt(unlocked, [2, 3, 0])).toBe(labelValueOf(unlocked));
    expect(maskValueAt(maskId, [2, 3, 0])).toBeFalsy();
    expect(maskValueAt(unlocked, [3, 3, 0])).toBe(0);
    expect(maskValueAt(maskId, [3, 3, 0])).toBe(labelValueOf(maskId));
  });

  it('shares the filled voxels with every neighbour while overlap is allowed', () => {
    const locked = addMask('img-1', 'Locked');
    const unlocked = addMask('img-1', 'Unlocked');
    seedVoxel(locked, [2, 3, 0]);
    seedVoxel(unlocked, [3, 3, 0]);
    lockSegment(locked, true);
    const maskId = addMask('img-1', 'Tumor');
    store().allowOverlap = true;

    rasterizeInto(maskId);

    expect(maskValueAt(locked, [2, 3, 0])).toBe(labelValueOf(locked));
    expect(maskValueAt(unlocked, [3, 3, 0])).toBe(labelValueOf(unlocked));
    expect(maskValueAt(maskId, [2, 3, 0])).toBe(labelValueOf(maskId));
    expect(maskValueAt(maskId, [3, 3, 0])).toBe(labelValueOf(maskId));
  });

  it('publishes each changed neighbor once before returning from a fill', () => {
    const neighbors = ['First', 'Second', 'Locked', 'Background'].map(
      (name) => {
        const id = addMask('img-1', name);
        const voxels = store().maskVoxels(id);
        voxels.materialize();
        voxels.ensureContains([0, 5, 0, 5, 0, 1]);
        if (name === 'First' || name === 'Second') voxels.scalars().fill(1);
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
    expect(maskValueAt(target, [2, 3, 1])).toBe(1);
    expect(maskValueAt(neighbors[0].id, [0, 0, 0])).toBe(1);
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

  it('consults the neighbours over the polygon, not the whole mask', () => {
    const maskId = addMask('img-1', 'Tumor');
    // A mask over the whole image: its own box says nothing about where this
    // polygon lands, and every neighbour touching it would be walked per
    // filled pixel.
    const voxels = store().maskVoxels(maskId);
    voxels.materialize();
    voxels.ensureContains([0, 5, 0, 5, 0, 1]);
    const voxelClaim = vi.spyOn(store(), 'voxelClaim');

    rasterizeInto(maskId);

    expect(voxelClaim).toHaveBeenCalledTimes(1);
    expect(voxelClaim.mock.calls[0][2]).toEqual([1, 4, 1, 4, 0, 0]);
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

// ---------------------------------------------------------------------------
// The voxels a polygon fills are a property of the polygon and the parent
// image, not of how much of the image its mask currently holds. Triangles with
// integer vertices are where an edge can cross a scanline exactly on a pixel
// centre, which is the tie an allocation-dependent fill resolves differently.
// ---------------------------------------------------------------------------

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
