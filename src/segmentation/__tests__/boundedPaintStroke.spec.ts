import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { createApp } from 'vue';

import { PaintMode } from '@/src/core/tools/paint';
import { extentContains, fullExtent } from '@/src/segmentation/geometry';
import { CorePiniaProviderPlugin } from '@/src/core/provider';
import { usePaintToolStore } from '@/src/store/tools/paint';
import {
  addMask,
  bindingOf,
  extentOf,
  labelValueOf,
  markedVoxels,
  maskValueAt,
  seatImage,
  seedVoxel,
  store,
  voxelCount,
  type Index3,
  selectSegment,
  lockSegment,
  boundMasks,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';

// ---------------------------------------------------------------------------
// A paint stroke against bounded masks:
//
//  - the stroke grows its own storage first, for the region it is about to
//    touch plus room around it, and only then captures
//    scalars/dimensions/strides;
//  - the threshold predicate reads the PARENT image, whose voxel offsets are
//    not the mask's, so it converts through the mask's extent;
//  - writing a voxel clears it in every other UNLOCKED mask of the image; a
//    locked one keeps it and the stroke goes around it. While overlap is
//    allowed no neighbour loses a voxel and the stroke goes around nothing.
// ---------------------------------------------------------------------------

const DIMENSIONS: Index3 = [4, 4, 4];

const parentOffset = (i: number, j: number, k: number) =>
  i + j * DIMENSIONS[0] + k * DIMENSIONS[0] * DIMENSIONS[1];

/** Unit spacing makes world points index points. */
function strokeAt(imageId: string, point: Index3, brushSize = 1) {
  const paintStore = usePaintToolStore();
  paintStore.setBrushSize(brushSize);
  paintStore.startStroke(point, 2, imageId);
  paintStore.endStroke(point, 2, imageId);
}

function strokeFromTo(imageId: string, from: Index3, to: Index3) {
  const paintStore = usePaintToolStore();
  paintStore.setBrushSize(1);
  paintStore.startStroke(from, 2, imageId);
  paintStore.endStroke(to, 2, imageId);
}

const activeSegment = (imageId: string, name: string) => {
  const maskId = addMask(imageId, name);
  selectSegment(maskId);
  return maskId;
};

/** A locked and an unlocked neighbour of the segment about to be painted. */
function neighboursOfActive(lockedAt: Index3, unlockedAt: Index3) {
  const locked = addMask('img-1', 'Locked');
  const unlocked = addMask('img-1', 'Unlocked');
  seedVoxel(locked, lockedAt);
  seedVoxel(unlocked, unlockedAt);
  lockSegment(locked, true);
  return { locked, unlocked, active: activeSegment('img-1', 'Tumor') };
}

/** Whether each of these masks holds the voxel at `index`. */
const holding = (index: Index3, ...maskIds: string[]) =>
  maskIds.map((maskId) => maskValueAt(maskId, index) === labelValueOf(maskId));

describe('painting into bounded masks', () => {
  beforeEach(() => {
    const pinia = createPinia().use(CorePiniaProviderPlugin());
    createApp({}).use(pinia);
    setActivePinia(pinia);
  });

  describe('growth', () => {
    it('grows storage from nothing to cover the stroke', async () => {
      await seatImage('img-1', { dimensions: DIMENSIONS });
      const active = activeSegment('img-1', 'Tumor');

      strokeAt('img-1', [1, 1, 0]);

      expect(maskValueAt(active, [1, 1, 0])).toBe(labelValueOf(active));
      expect(extentContains(extentOf(active)!, [1, 1, 1, 1, 0, 0])).toBe(true);
      expect(extentContains(fullExtent(DIMENSIONS), extentOf(active)!)).toBe(
        true
      );
    });

    it('asks for room beyond the stroke so the next sample grows nothing', async () => {
      await seatImage('img-1', { dimensions: [64, 64, 8] });
      const active = activeSegment('img-1', 'Tumor');

      strokeAt('img-1', [20, 20, 4]);
      const before = store().maskVoxels(active).scalars();
      strokeAt('img-1', [21, 21, 4]);

      expect(store().maskVoxels(active).scalars()).toBe(before);
      expect(extentContains(fullExtent([64, 64, 8]), extentOf(active)!)).toBe(
        true
      );
    });

    it('covers the whole interpolated stroke, not just its ends', async () => {
      await seatImage('img-1', { dimensions: DIMENSIONS });
      const active = activeSegment('img-1', 'Tumor');

      strokeFromTo('img-1', [1, 1, 0], [3, 1, 0]);

      const labelValue = labelValueOf(active);
      expect(maskValueAt(active, [1, 1, 0])).toBe(labelValue);
      expect(maskValueAt(active, [2, 1, 0])).toBe(labelValue);
      expect(maskValueAt(active, [3, 1, 0])).toBe(labelValue);
    });

    it('keeps the earlier stroke when a later one grows the mask', async () => {
      await seatImage('img-1', { dimensions: DIMENSIONS });
      const active = activeSegment('img-1', 'Tumor');

      strokeAt('img-1', [1, 1, 0]);
      strokeAt('img-1', [3, 3, 2]);

      const labelValue = labelValueOf(active);
      expect(maskValueAt(active, [1, 1, 0])).toBe(labelValue);
      expect(maskValueAt(active, [3, 3, 2])).toBe(labelValue);
      expect(extentContains(extentOf(active)!, [1, 3, 1, 3, 0, 2])).toBe(true);
    });

    it('clips the growth to the parent image when the brush overhangs it', async () => {
      await seatImage('img-1', { dimensions: DIMENSIONS });
      const active = activeSegment('img-1', 'Tumor');

      expect(() => strokeAt('img-1', [0, 0, 0], 3)).not.toThrow();

      const extent = extentOf(active)!;
      expect(maskValueAt(active, [0, 0, 0])).toBe(labelValueOf(active));
      expect(extent[0]).toBe(0);
      expect(extent[2]).toBe(0);
      expect(extentContains(fullExtent(DIMENSIONS), extent)).toBe(true);
    });

    it('allocates nothing when erasing where the segment has no voxels', async () => {
      await seatImage('img-1', { dimensions: DIMENSIONS });
      const active = activeSegment('img-1', 'Tumor');
      usePaintToolStore().setMode(PaintMode.Erase);

      strokeAt('img-1', [1, 1, 0]);

      // No binding at all, not an empty one: erase refuses before the segment
      // gets storage it has nothing to take from.
      expect(bindingOf(active)).toBeUndefined();
      expect(boundMasks()).toHaveLength(0);
    });

    it('mints no segment when erasing on an image that has none', async () => {
      await seatImage('img-1', { dimensions: DIMENSIONS });
      usePaintToolStore().setMode(PaintMode.Erase);

      strokeAt('img-1', [1, 1, 0]);

      expect(store().getSegmentationForImage('img-1')).toBeUndefined();
      expect(store().findEditTarget('img-1')).toBeUndefined();
      expect(boundMasks()).toHaveLength(0);
    });
  });

  describe('thresholding against the parent image', () => {
    const withParentValues = async () => {
      const values = new Uint8Array(voxelCount(DIMENSIONS));
      values[parentOffset(2, 2, 0)] = 100;
      values[parentOffset(3, 2, 0)] = 0;
      // The offsets a mask starting at (2, 2, 0) would hit if the predicate
      // read the parent by the mask's own offsets instead of converting.
      values[parentOffset(0, 0, 0)] = 0;
      values[parentOffset(1, 0, 0)] = 100;
      await seatImage('img-1', { dimensions: DIMENSIONS, values });

      const active = activeSegment('img-1', 'Tumor');
      const voxels = store().maskVoxels(active);
      voxels.materialize();
      voxels.ensureContains([2, 3, 2, 2, 0, 0]);

      const paintStore = usePaintToolStore();
      paintStore.setThresholdRange([50, 200]);
      return active;
    };

    it('paints where the parent voxel under the mask voxel is in range', async () => {
      const active = await withParentValues();

      strokeAt('img-1', [2, 2, 0]);

      expect(maskValueAt(active, [2, 2, 0])).toBe(labelValueOf(active));
    });

    it('refuses where the parent voxel under the mask voxel is out of range', async () => {
      const active = await withParentValues();

      strokeAt('img-1', [3, 2, 0]);

      expect(maskValueAt(active, [3, 2, 0])).toBeFalsy();
    });
  });

  describe('rounding the stroke on the parent grid', () => {
    // The line between two samples is walked by accumulating fractional steps
    // and rounding, so where the walk starts decides which side of a half a
    // step lands on.
    const WIDE: Index3 = [48, 24, 2];
    const STROKE: [Index3, Index3] = [
      [30, 2, 0],
      [35, 8, 0],
    ];

    const paintedOn = (imageId: string, wholeParent = false) => {
      const maskId = addMask(imageId, 'Target');
      if (wholeParent) {
        const voxels = store().maskVoxels(maskId);
        voxels.materialize();
        voxels.ensureContains(fullExtent(WIDE));
      }
      selectSegment(maskId);
      const paintStore = usePaintToolStore();
      paintStore.setBrushSize(1);
      paintStore.startStroke(STROKE[0], 2, imageId);
      paintStore.endStroke(STROKE[1], 2, imageId);
      return {
        maskId,
        painted: markedVoxels(maskId)!.map(([i, j, k]) => `${i},${j},${k}`),
      };
    };

    it('paints the same voxels whatever offset the mask starts at', async () => {
      // One image each: an aimed write clears the voxel in the other masks of
      // its own image, which would rub out the set being compared against.
      await seatImage('img-1', { dimensions: WIDE });
      await seatImage('img-2', { dimensions: WIDE });

      const wholeParent = paintedOn('img-1', true);
      const bounded = paintedOn('img-2');

      // The two masks hold the stroke at different offsets, which is the whole
      // point of the comparison.
      expect(extentOf(bounded.maskId)![0]).not.toBe(
        extentOf(wholeParent.maskId)![0]
      );
      expect(bounded.painted).toEqual(wholeParent.painted);
    });
  });

  describe('overwriting the other segments', () => {
    it('clears the painted voxel in a neighbour’s mask and marks it modified', async () => {
      await seatImage('img-1', { dimensions: DIMENSIONS });
      const neighbor = addMask('img-1', 'Neighbour');
      seedVoxel(neighbor, [1, 1, 0]);
      const active = activeSegment('img-1', 'Tumor');
      const modified = store().maskVoxels(neighbor).image().getMTime();

      strokeAt('img-1', [1, 1, 0]);

      expect(maskValueAt(neighbor, [1, 1, 0])).toBe(0);
      expect(maskValueAt(active, [1, 1, 0])).toBe(labelValueOf(active));
      expect(store().maskVoxels(neighbor).image().getMTime()).toBeGreaterThan(
        modified
      );
    });

    it('leaves the neighbour’s other voxels alone', async () => {
      await seatImage('img-1', { dimensions: DIMENSIONS });
      const neighbor = addMask('img-1', 'Neighbour');
      seedVoxel(neighbor, [1, 1, 0]);
      seedVoxel(neighbor, [2, 1, 0]);
      activeSegment('img-1', 'Tumor');

      strokeAt('img-1', [1, 1, 0]);

      expect(maskValueAt(neighbor, [2, 1, 0])).toBe(labelValueOf(neighbor));
    });

    it('leaves the segments of another image alone', async () => {
      await seatImage('img-1', { dimensions: DIMENSIONS });
      await seatImage('img-2', { dimensions: DIMENSIONS });
      const elsewhere = addMask('img-2', 'Elsewhere');
      seedVoxel(elsewhere, [1, 1, 0]);
      activeSegment('img-1', 'Tumor');

      strokeAt('img-1', [1, 1, 0]);

      expect(maskValueAt(elsewhere, [1, 1, 0])).toBe(labelValueOf(elsewhere));
    });

    it('erases its own voxels without clearing the neighbour’s', async () => {
      await seatImage('img-1', { dimensions: DIMENSIONS });
      const neighbor = addMask('img-1', 'Neighbour');
      seedVoxel(neighbor, [1, 1, 0]);
      const active = activeSegment('img-1', 'Tumor');
      strokeAt('img-1', [2, 1, 0]);

      usePaintToolStore().setMode(PaintMode.Erase);
      strokeAt('img-1', [1, 1, 0]);
      strokeAt('img-1', [2, 1, 0]);

      expect(maskValueAt(neighbor, [1, 1, 0])).toBe(labelValueOf(neighbor));
      expect(maskValueAt(active, [1, 1, 0])).toBeFalsy();
      expect(maskValueAt(active, [2, 1, 0])).toBeFalsy();
    });

    it('goes around a locked neighbour instead of taking the voxel', async () => {
      await seatImage('img-1', { dimensions: DIMENSIONS });
      const neighbor = addMask('img-1', 'Neighbour');
      seedVoxel(neighbor, [1, 1, 0]);
      lockSegment(neighbor, true);
      const active = activeSegment('img-1', 'Tumor');

      strokeAt('img-1', [1, 1, 0]);

      expect(maskValueAt(neighbor, [1, 1, 0])).toBe(labelValueOf(neighbor));
      expect(maskValueAt(active, [1, 1, 0])).toBeFalsy();
    });

    it('takes a voxel a locked neighbour holds from nobody', async () => {
      await seatImage('img-1', { dimensions: DIMENSIONS });
      const { locked, unlocked, active } = neighboursOfActive(
        [1, 1, 0],
        [1, 1, 0]
      );

      strokeAt('img-1', [1, 1, 0]);

      expect(holding([1, 1, 0], locked, unlocked, active)).toEqual([
        true,
        true,
        false,
      ]);
    });

    it('takes from an unlocked neighbour and goes around a locked one in one stroke', async () => {
      await seatImage('img-1', { dimensions: DIMENSIONS });
      const { locked, unlocked, active } = neighboursOfActive(
        [1, 1, 0],
        [2, 1, 0]
      );

      strokeFromTo('img-1', [1, 1, 0], [2, 1, 0]);

      expect(holding([1, 1, 0], locked, active)).toEqual([true, false]);
      expect(holding([2, 1, 0], unlocked, active)).toEqual([false, true]);
    });

    it('shares the voxel with every neighbour while overlap is allowed', async () => {
      await seatImage('img-1', { dimensions: DIMENSIONS });
      const { locked, unlocked, active } = neighboursOfActive(
        [1, 1, 0],
        [1, 1, 0]
      );
      store().allowOverlap = true;

      strokeAt('img-1', [1, 1, 0]);

      expect(holding([1, 1, 0], locked, unlocked, active)).toEqual([
        true,
        true,
        true,
      ]);
    });
  });
});
