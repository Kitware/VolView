import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import {
  seatSpecImage as seatImage,
  expectCoveredExtentIsNoop,
  expectExtentPastParentThrows,
  SPEC_DIMENSIONS as DIMENSIONS,
  mintSegment,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';

import { useSegmentationStore } from '@/src/segmentation/store';
import { isEmptyExtent, type Extent3D } from '@/src/segmentation/geometry';
import vtkLabelMap from '@/src/vtk/LabelMap';

// ---------------------------------------------------------------------------
// The segment voxel accessor: the one contract every labelmap consumer that
// holds a segment routes through. Growth itself is pinned in
// boundedSegmentMasks.spec.ts; what is here is the accessor's own contract
// against a mask grown to the whole parent image.
// ---------------------------------------------------------------------------

const VOXEL_COUNT = DIMENSIONS[0] * DIMENSIONS[1] * DIMENSIONS[2];
const FULL_EXTENT: Extent3D = [0, 3, 0, 3, 0, 1];

const store = () => useSegmentationStore();

/** A segment with no storage: "add segment" never allocates voxels. */
function addMask(imageId: string, name?: string) {
  const segmentation = store().ensureSegmentationForImage(imageId);
  const segment = store().createMask(
    segmentation.id,
    mintSegment(name ? { name } : undefined)
  );
  return { segmentationId: segmentation.id, maskId: segment.id };
}

/**
 * Two segments of one image, each with its own mask grown to the whole parent
 * image, so identity assertions have a labelmap reference to compare against.
 */
function seatArtifactSegment(imageId: string, values: Uint8Array) {
  const first = addMask(imageId, 'Tumor');
  const second = addMask(imageId, 'Node');

  const grow = (target: { maskId: string }) => {
    const voxels = store().maskVoxels(target.maskId);
    voxels.materialize();
    voxels.ensureContains(FULL_EXTENT);
  };
  grow(first);
  grow(second);
  store().maskVoxels(first.maskId).apply(values);

  return {
    labelmap: store().maskVoxels(first.maskId).image(),
    segmentationId: first.segmentationId,
    first,
    second,
  };
}

const voxelsOf = (target: { segmentationId: string; maskId: string }) =>
  store().maskVoxels(target.maskId);

const scalarsOf = (labelmap: vtkLabelMap) =>
  labelmap.getPointData().getScalars().getData();

describe('segment voxel accessor', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatImage('img-1');
  });

  describe('resolution', () => {
    it('throws for a segment that does not exist', () => {
      store().ensureSegmentationForImage('img-1');
      expect(() => store().maskVoxels('nope')).toThrow(/No such segment/);
    });

    it('resolves the segment on every call rather than capturing it', () => {
      const target = addMask('img-1');
      const voxels = voxelsOf(target);
      expect(voxels.binding()).toBeUndefined();

      // Materializing through a second accessor is visible through the first.
      voxelsOf(target).materialize();
      expect(voxels.binding()?.image).toBeDefined();

      store().deleteMask(target.maskId);
      expect(() => voxels.binding()).toThrow();
    });
  });

  describe('before materialize', () => {
    it('reports no storage and allocates none', () => {
      const target = addMask('img-1');

      expect(voxelsOf(target).binding()).toBeUndefined();
      expect(store().maskLayersForImage('img-1')).toHaveLength(0);
    });

    it('refuses voxel access instead of allocating on read', () => {
      const target = addMask('img-1');
      const voxels = voxelsOf(target);

      expect(() => voxels.image()).toThrow();
      expect(() => voxels.snapshot()).toThrow();
      expect(() => voxels.apply(new Uint8Array(VOXEL_COUNT))).toThrow();
      expect(() => voxels.ensureContains(FULL_EXTENT)).toThrow();
      expect(store().maskLayersForImage('img-1')).toHaveLength(0);
    });
  });

  describe('materialize', () => {
    it('allocates a mask that covers nothing and binds the segment to it', () => {
      const target = addMask('img-1');
      const binding = voxelsOf(target).materialize();

      expect(store().maskLayersForImage('img-1')).toHaveLength(1);
      expect(store().maskLayersForImage('img-1')[0].maskId).toBe(target.maskId);
      expect(isEmptyExtent(binding.extent)).toBe(true);
      expect(voxelsOf(target).image().getDimensions()).toEqual([0, 0, 0]);
      expect(scalarsOf(voxelsOf(target).image())).toHaveLength(0);
    });

    it('is idempotent', () => {
      const target = addMask('img-1');
      const first = voxelsOf(target).materialize();
      const image = voxelsOf(target).image();
      const second = voxelsOf(target).materialize();

      expect(second).toEqual(first);
      expect(store().maskLayersForImage('img-1')).toHaveLength(1);
      expect(voxelsOf(target).image()).toBe(image);
    });

    it('gives each segment of an image its own mask, with distinct label values', () => {
      const first = addMask('img-1', 'Tumor');
      const second = addMask('img-1', 'Node');

      const a = voxelsOf(first).materialize();
      const b = voxelsOf(second).materialize();

      expect(store().maskLayersForImage('img-1')).toHaveLength(2);
      expect(b.image).not.toBe(a.image);
      expect(voxelsOf(second).image()).not.toBe(voxelsOf(first).image());
    });
  });

  describe('image()', () => {
    it('hands back the live labelmap the binding holds', () => {
      const seat = seatArtifactSegment('img-1', new Uint8Array(VOXEL_COUNT));
      const voxels = voxelsOf(seat.first);

      expect(voxels.image()).toBe(seat.labelmap);
      expect(voxels.binding()?.image).toBe(seat.labelmap);
    });

    it('sees writes made through it', () => {
      const seat = seatArtifactSegment('img-1', new Uint8Array(VOXEL_COUNT));
      const voxels = voxelsOf(seat.first);

      scalarsOf(voxels.image())[5] = 1;

      expect(Array.from(voxels.snapshot())[5]).toBe(1);
      expect(Array.from(scalarsOf(seat.labelmap))[5]).toBe(1);
    });
  });

  describe('scalars()', () => {
    it('aliases the live buffer rather than copying it', () => {
      const seat = seatArtifactSegment('img-1', new Uint8Array(VOXEL_COUNT));
      const voxels = voxelsOf(seat.first);

      // The paint stroke reads this per candidate voxel while the brush writes
      // the same buffer, so a copy would be both stale and a per-stroke
      // allocation the size of the volume.
      expect(voxels.scalars()).toBe(scalarsOf(seat.labelmap));

      voxels.scalars()[5] = 1;
      expect(scalarsOf(seat.labelmap)[5]).toBe(1);
    });

    it('refuses before materialize', () => {
      const target = addMask('img-1');

      expect(() => voxelsOf(target).scalars()).toThrow(/No storage/);
      expect(store().maskLayersForImage('img-1')).toHaveLength(0);
    });
  });

  describe('snapshot()', () => {
    it('copies the voxels instead of aliasing them', () => {
      const values = new Uint8Array(VOXEL_COUNT);
      values[0] = 1;
      const seat = seatArtifactSegment('img-1', values);
      const voxels = voxelsOf(seat.first);

      const copy = voxels.snapshot();
      expect(Array.from(copy)).toEqual(Array.from(scalarsOf(seat.labelmap)));

      copy[0] = 9;
      expect(scalarsOf(seat.labelmap)[0]).toBe(1);

      scalarsOf(seat.labelmap)[1] = 7;
      expect(copy[1]).toBe(0);
    });

    it('covers the whole mask the segment writes through', () => {
      const values = new Uint8Array(VOXEL_COUNT);
      values[0] = 1;
      values[1] = 2;
      const seat = seatArtifactSegment('img-1', values);

      expect(Array.from(voxelsOf(seat.first).snapshot()).slice(0, 2)).toEqual([
        1, 2,
      ]);
      expect(voxelsOf(seat.second).snapshot()).toHaveLength(VOXEL_COUNT);
    });
  });

  describe('apply()', () => {
    it('replaces the voxels and marks the image modified', () => {
      const seat = seatArtifactSegment('img-1', new Uint8Array(VOXEL_COUNT));
      const voxels = voxelsOf(seat.first);
      const before = seat.labelmap.getMTime();

      const next = new Uint8Array(VOXEL_COUNT);
      next[3] = 1;
      next[4] = 2;
      voxels.apply(next);

      expect(Array.from(voxels.snapshot()).slice(3, 5)).toEqual([1, 2]);
      // Actors bind to the image, so bulk replace must not swap it out.
      expect(voxels.image()).toBe(seat.labelmap);
      expect(seat.labelmap.getMTime()).toBeGreaterThan(before);
    });

    it('rejects a wrong-length array and leaves the voxels alone', () => {
      const values = new Uint8Array(VOXEL_COUNT);
      values[0] = 1;
      const seat = seatArtifactSegment('img-1', values);
      const voxels = voxelsOf(seat.first);

      expect(() => voxels.apply(new Uint8Array(VOXEL_COUNT - 1))).toThrow();
      expect(Array.from(voxels.snapshot())).toEqual(
        Array.from(scalarsOf(seat.labelmap))
      );
      expect(scalarsOf(seat.labelmap)[0]).toBe(1);
    });
  });

  describe('ensureContains()', () => {
    it('reports no invalidation for an extent the storage already covers', () => {
      const seat = seatArtifactSegment('img-1', new Uint8Array(VOXEL_COUNT));

      expectCoveredExtentIsNoop(voxelsOf(seat.first), seat.labelmap);
    });

    it('treats an empty extent as already covered', () => {
      const seat = seatArtifactSegment('img-1', new Uint8Array(VOXEL_COUNT));

      expect(voxelsOf(seat.first).ensureContains([0, -1, 0, -1, 0, -1])).toBe(
        false
      );
    });

    it('rejects an extent that leaves the parent image', () => {
      const seat = seatArtifactSegment('img-1', new Uint8Array(VOXEL_COUNT));

      expectExtentPastParentThrows(voxelsOf(seat.first), seat.labelmap);
    });
  });
});
