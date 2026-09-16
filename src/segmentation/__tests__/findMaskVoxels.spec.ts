import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import {
  seatSpecImage,
  SPEC_FULL_EXTENT as FULL_EXTENT,
  SPEC_VOXEL_COUNT as VOXEL_COUNT,
  deleteSegmentOf,
  mintSegment,
  store,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';

// ---------------------------------------------------------------------------
// The tolerant half of the voxel accessor seam. Unlike maskVoxels(), this one
// is constructible for a segment that is already gone: the renderer, the paint
// widget and the probe are Vue computeds keyed on a mask id that can vanish a
// tick before the component does. Its contract on existing storage is pinned
// alongside the strict one in segmentVoxels.spec.ts.
// ---------------------------------------------------------------------------

/** A mask grown to the whole parent image, holding nothing. */
function seatMask(imageId: string) {
  const segmentation = store().ensureSegmentationForImage(imageId);
  const segment = store().createMask(
    segmentation.id,
    mintSegment({ name: 'Tumor' })
  );
  const voxels = store().maskVoxels(segment.id);
  voxels.materialize();
  voxels.ensureContains(FULL_EXTENT);
  return segment.id;
}

describe('tolerant mask voxel accessor', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatSpecImage('img-1');
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
      const maskId = seatMask('img-1');
      const voxels = store().findMaskVoxels(maskId);
      expect(voxels.exists()).toBe(true);

      deleteSegmentOf(maskId);

      expect(voxels.exists()).toBe(false);
      expect(() => voxels.image()).toThrow();
    });
  });

  describe('shared storage', () => {
    it('shows a strict accessor write through the tolerant one', () => {
      const maskId = seatMask('img-1');

      const next = new Uint8Array(VOXEL_COUNT);
      next[2] = 1;
      store().maskVoxels(maskId).apply(next);

      expect(Array.from(store().findMaskVoxels(maskId).snapshot())[2]).toBe(1);
    });

    it('shows a tolerant accessor write through the strict one', () => {
      const maskId = seatMask('img-1');

      store().findMaskVoxels(maskId).scalars()[6] = 1;

      expect(Array.from(store().maskVoxels(maskId).snapshot())[6]).toBe(1);
    });
  });
});
