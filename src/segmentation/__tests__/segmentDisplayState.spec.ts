import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import {
  seatSpecImage,
  SPEC_DIMENSIONS as DIMENSIONS,
  labelmapValues,
  makeLabelmap,
  store,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';

import { useSegmentStore } from '@/src/segmentation/segments';
import { DEFAULT_SEGMENTATION_FILL_OPACITY } from '@/src/segmentation/model';
import { toLabelmapSegment } from '@/src/segmentation/segment';
import { SEGMENT_VALUE } from '@/src/segmentation/masks/labelValue';
import { useLabelmapImportStore } from '@/src/segmentation/io/labelmapImport';

// Segments hold opacity; the per-image segmentation holds its multipliers.

const segments = () => useSegmentStore().segments;

/** A labelmap in the parent's space, carrying one voxel of value 1. */
const makeImportedLabelmap = () =>
  makeLabelmap({
    dimensions: DIMENSIONS,
    values: labelmapValues(DIMENSIONS, [{ value: 1, at: [0, 0, 0] }]),
  });

describe('segmentation display state', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatSpecImage('img-1');
  });

  describe('defaults', () => {
    // A fresh segmentation tints the anatomy under it; the outline defaults
    // match what a legacy per-view config carried.
    it('gives a new segmentation a translucent fill and a 2px outline', () => {
      store().materializeMask(segments().mintSegment('img-1'));

      const display = segments().displayOf('img-1');
      expect(display.fillOpacity).toBe(DEFAULT_SEGMENTATION_FILL_OPACITY);
      expect(display.outlineOpacity).toBe(1);
      expect(display.outlineThickness).toBe(2);
    });

    it('gives a segment minted by the edit path the same defaults', () => {
      const segmentId = store().resolveEditTarget('img-1');

      const appearance = segments().appearanceOf(segmentId);
      expect(appearance.fillOpacity).toBe(1);
      expect(appearance.outlineOpacity).toBe(1);
    });

    it('takes display state from a decoded segment descriptor', () => {
      const [segmentId] = useLabelmapImportStore().splitLabelmapIntoMasks(
        'img-1',
        makeImportedLabelmap(),
        [
          {
            value: 1,
            name: 'Tumor',
            color: [255, 0, 0, 255],
            visible: false,
            locked: true,
            fillOpacity: 0.4,
            outlineOpacity: 0.25,
          },
        ]
      );

      // Opacity describes the thing shown, so it lands on the segment it minted.
      const appearance = segments().appearanceOf(segmentId);
      expect(appearance.fillOpacity).toBe(0.4);
      expect(appearance.outlineOpacity).toBe(0.25);
      // Visibility and lock describe the thing, so they land on the segment.
      expect(appearance.visible).toBe(false);
      expect(appearance.locked).toBe(true);
    });
  });

  describe('editing', () => {
    it('patches display state through the segment without disturbing identity', () => {
      const segmentId = segments().mintSegment('img-1', { name: 'Tumor' });
      const binding = store().materializeMask(segmentId);
      expect(segments().appearanceOf(segmentId).fillOpacity).toBe(1);

      segments().updateSegment(segmentId, { fillOpacity: 0.4 });
      segments().updateSegment(segmentId, { outlineOpacity: 0.25 });

      const appearance = segments().appearanceOf(segmentId);
      expect(appearance.fillOpacity).toBe(0.4);
      expect(appearance.outlineOpacity).toBe(0.25);
      expect(store().maskOf(segmentId)).toBe(binding);
      expect(appearance.name).toBe('Tumor');
      expect(appearance.visible).toBe(true);
    });

    it('keeps display state per segment', () => {
      const first = segments().mintSegment('img-1');
      const second = segments().mintSegment('img-1');
      store().materializeMask(first);
      store().materializeMask(second);

      segments().updateSegment(first, {
        fillOpacity: 0,
        outlineOpacity: 0.5,
      });

      const sibling = segments().appearanceOf(second);
      expect(sibling.fillOpacity).toBe(1);
      expect(sibling.outlineOpacity).toBe(1);
      expect(segments().displayOf('img-1').fillOpacity).toBe(
        DEFAULT_SEGMENTATION_FILL_OPACITY
      );
    });
  });

  // Without this the editor's sliders write state nothing renders from.
  describe('reaching the renderer', () => {
    it("hands each segment's opacities to its mask's label descriptor", () => {
      const segmentId = segments().mintSegment('img-1', { name: 'Tumor' });
      store().maskVoxels(segmentId).materialize();

      segments().updateSegment(segmentId, {
        fillOpacity: 0.4,
        outlineOpacity: 0.25,
      });

      expect(
        toLabelmapSegment(segments().getSegment(segmentId), SEGMENT_VALUE)
      ).toEqual(
        expect.objectContaining({ fillOpacity: 0.4, outlineOpacity: 0.25 })
      );
    });
  });
});
