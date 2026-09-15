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
import type { Extent3D } from '@/src/segmentation/geometry';
import vtkLabelMap from '@/src/vtk/LabelMap';

// ---------------------------------------------------------------------------
// The tolerant half of the voxel accessor seam. Unlike maskVoxels(), this one
// is constructible for a segment that is already gone: the renderer, the paint
// widget and the probe are Vue computeds keyed on a mask id that can vanish a
// tick before the component does.
// ---------------------------------------------------------------------------

const VOXEL_COUNT = DIMENSIONS[0] * DIMENSIONS[1] * DIMENSIONS[2];
const FULL_EXTENT: Extent3D = [0, 3, 0, 3, 0, 1];

const store = () => useSegmentationStore();

/** A segment grown to the whole parent image, and the buffer that holds it. */
function seatArtifact(imageId: string, values = new Uint8Array(VOXEL_COUNT)) {
  const segmentation = store().ensureSegmentationForImage(imageId);
  const segment = store().createMask(
    segmentation.id,
    mintSegment({ name: 'Tumor' })
  );
  const voxels = store().maskVoxels(segment.id);
  voxels.materialize();
  voxels.ensureContains(FULL_EXTENT);
  voxels.apply(values);

  return {
    labelmap: voxels.image(),
    maskId: segment.id,
    segmentationId: segmentation.id,
  };
}

const scalarsOf = (labelmap: vtkLabelMap) =>
  labelmap.getPointData().getScalars().getData();

describe('tolerant mask voxel accessor', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatImage('img-1');
  });

  describe('resolution', () => {
    it('is constructible for a segment that does not exist', () => {
      expect(() => store().findMaskVoxels('nope')).not.toThrow();
      expect(store().findMaskVoxels('nope').exists()).toBe(false);
    });

    it('refuses voxel access for a segment that does not exist', () => {
      const voxels = store().findMaskVoxels('nope');

      expect(() => voxels.image()).toThrow();
      expect(() => voxels.scalars()).toThrow();
      expect(() => voxels.snapshot()).toThrow();
      expect(() => voxels.apply(new Uint8Array(VOXEL_COUNT))).toThrow();
      expect(() => voxels.ensureContains(FULL_EXTENT)).toThrow();
    });

    it('re-resolves the storage on every call rather than capturing it', () => {
      const seat = seatArtifact('img-1');
      const voxels = store().findMaskVoxels(seat.maskId);
      expect(voxels.exists()).toBe(true);

      store().deleteMask(seat.maskId);

      expect(voxels.exists()).toBe(false);
      expect(() => voxels.image()).toThrow();
    });
  });

  describe('image()', () => {
    it('hands back the live labelmap the binding holds', () => {
      const seat = seatArtifact('img-1');

      expect(store().findMaskVoxels(seat.maskId).image()).toBe(seat.labelmap);
    });

    it('is the same storage the strict accessor resolves', () => {
      const seat = seatArtifact('img-1');

      expect(store().findMaskVoxels(seat.maskId).image()).toBe(
        store().maskVoxels(seat.maskId).image()
      );
    });
  });

  describe('scalars()', () => {
    it('aliases the live buffer rather than copying it', () => {
      const seat = seatArtifact('img-1');
      const voxels = store().findMaskVoxels(seat.maskId);

      expect(voxels.scalars()).toBe(scalarsOf(seat.labelmap));

      voxels.scalars()[5] = 1;
      expect(scalarsOf(seat.labelmap)[5]).toBe(1);
    });
  });

  describe('snapshot()', () => {
    it('copies the voxels instead of aliasing them', () => {
      const values = new Uint8Array(VOXEL_COUNT);
      values[0] = 1;
      const seat = seatArtifact('img-1', values);
      const voxels = store().findMaskVoxels(seat.maskId);

      const copy = voxels.snapshot();
      expect(copy).not.toBe(scalarsOf(seat.labelmap));
      expect(Array.from(copy)).toEqual(Array.from(scalarsOf(seat.labelmap)));

      copy[0] = 9;
      expect(scalarsOf(seat.labelmap)[0]).toBe(1);
    });

    it('copies the whole mask, every label value included', () => {
      const values = new Uint8Array(VOXEL_COUNT);
      values[0] = 1;
      values[1] = 2;
      const seat = seatArtifact('img-1', values);

      const copy = store().findMaskVoxels(seat.maskId).snapshot();
      expect(copy).toHaveLength(VOXEL_COUNT);
      expect(Array.from(copy).slice(0, 2)).toEqual([1, 2]);
    });
  });

  describe('apply()', () => {
    it('writes through the live buffer instead of swapping it out', () => {
      const seat = seatArtifact('img-1');
      const voxels = store().findMaskVoxels(seat.maskId);
      const buffer = scalarsOf(seat.labelmap);
      const before = seat.labelmap.getMTime();

      const next = new Uint8Array(VOXEL_COUNT);
      next[3] = 1;
      next[4] = 2;
      voxels.apply(next);

      // Mappers and the paint engine hold the buffer, not just the image.
      expect(scalarsOf(seat.labelmap)).toBe(buffer);
      expect(voxels.image()).toBe(seat.labelmap);
      expect(Array.from(buffer).slice(3, 5)).toEqual([1, 2]);
      expect(seat.labelmap.getMTime()).toBeGreaterThan(before);
    });

    it('copies the given scalars instead of adopting them', () => {
      const seat = seatArtifact('img-1');
      const voxels = store().findMaskVoxels(seat.maskId);

      const next = new Uint8Array(VOXEL_COUNT);
      next[0] = 1;
      voxels.apply(next);
      next[0] = 7;

      expect(scalarsOf(seat.labelmap)[0]).toBe(1);
    });

    it('rejects a wrong-length array and leaves the voxels alone', () => {
      const values = new Uint8Array(VOXEL_COUNT);
      values[0] = 1;
      const seat = seatArtifact('img-1', values);
      const voxels = store().findMaskVoxels(seat.maskId);

      expect(() => voxels.apply(new Uint8Array(VOXEL_COUNT - 1))).toThrow();
      expect(Array.from(scalarsOf(seat.labelmap))).toEqual(Array.from(values));
    });
  });

  describe('ensureContains()', () => {
    it('reports no invalidation for an extent the storage already covers', () => {
      const seat = seatArtifact('img-1');

      expectCoveredExtentIsNoop(
        store().findMaskVoxels(seat.maskId),
        seat.labelmap
      );
    });

    it('treats an empty extent as already covered', () => {
      const seat = seatArtifact('img-1');

      expect(
        store()
          .findMaskVoxels(seat.maskId)
          .ensureContains([0, -1, 0, -1, 0, -1])
      ).toBe(false);
    });

    it('rejects an extent that leaves the parent image', () => {
      const seat = seatArtifact('img-1');

      expectExtentPastParentThrows(
        store().findMaskVoxels(seat.maskId),
        seat.labelmap
      );
    });
  });

  describe('shared storage', () => {
    it('shows a strict accessor write through the tolerant one', () => {
      const seat = seatArtifact('img-1');
      const segment = store().maskVoxels(seat.maskId);

      const next = new Uint8Array(VOXEL_COUNT);
      next[2] = 1;
      segment.apply(next);

      expect(
        Array.from(store().findMaskVoxels(seat.maskId).snapshot())[2]
      ).toBe(1);
    });

    it('shows a tolerant accessor write through the strict one', () => {
      const seat = seatArtifact('img-1');

      store().findMaskVoxels(seat.maskId).scalars()[6] = 2;

      expect(Array.from(store().maskVoxels(seat.maskId).snapshot())[6]).toBe(2);
    });
  });
});
