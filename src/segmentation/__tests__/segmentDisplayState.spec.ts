import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import {
  seatSpecImage,
  SPEC_DIMENSIONS as DIMENSIONS,
  labelmapValues,
  makeLabelmap,
  mintSegment,
  store,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';

import { useSegmentStore } from '@/src/segmentation/segments';
import { DEFAULT_SEGMENTATION_FILL_OPACITY } from '@/src/segmentation/model';

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
      const segmentation = store().ensureSegmentationForImage('img-1');

      expect(segmentation.fillOpacity).toBe(DEFAULT_SEGMENTATION_FILL_OPACITY);
      expect(segmentation.outlineOpacity).toBe(1);
      expect(segmentation.outlineThickness).toBe(2);
    });

    it('gives a segment minted by the edit path the same defaults', () => {
      const segment = store().getMask(store().resolveEditTarget('img-1'));

      const appearance = segments().appearanceOf(segment.segmentId);
      expect(appearance.fillOpacity).toBe(1);
      expect(appearance.outlineOpacity).toBe(1);
    });

    it('takes display state from a decoded segment descriptor', () => {
      const [segment] = store().splitLabelmapIntoMasks(
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
      const appearance = segments().appearanceOf(segment.segmentId);
      expect(appearance.fillOpacity).toBe(0.4);
      expect(appearance.outlineOpacity).toBe(0.25);
      // Visibility and lock describe the thing, so they land on the segment.
      expect(appearance.visible).toBe(false);
      expect(appearance.locked).toBe(true);
    });
  });

  describe('editing', () => {
    it('patches display state through the segment without disturbing identity', () => {
      const segmentation = store().ensureSegmentationForImage('img-1');
      const segment = store().createMask(
        segmentation.id,
        mintSegment({ name: 'Tumor' })
      );
      expect(segments().appearanceOf(segment.segmentId).fillOpacity).toBe(1);

      segments().updateSegment(segment.segmentId, { fillOpacity: 0.4 });
      segments().updateSegment(segment.segmentId, { outlineOpacity: 0.25 });

      const updated = store().getMask(segment.id);
      const appearance = segments().appearanceOf(updated.segmentId);
      expect(appearance.fillOpacity).toBe(0.4);
      expect(appearance.outlineOpacity).toBe(0.25);
      expect(updated.id).toBe(segment.id);
      expect(updated.segmentId).toBe(segment.segmentId);
      expect(appearance.name).toBe('Tumor');
      expect(appearance.visible).toBe(true);
    });

    it('keeps display state per segment', () => {
      const segmentation = store().ensureSegmentationForImage('img-1');
      const first = store().createMask(segmentation.id, mintSegment());
      const second = store().createMask(segmentation.id, mintSegment());

      segments().updateSegment(first.segmentId, {
        fillOpacity: 0,
        outlineOpacity: 0.5,
      });

      const sibling = segments().appearanceOf(
        store().getMask(second.id).segmentId
      );
      expect(sibling.fillOpacity).toBe(1);
      expect(sibling.outlineOpacity).toBe(1);
      expect(store().segmentations[segmentation.id].fillOpacity).toBe(
        DEFAULT_SEGMENTATION_FILL_OPACITY
      );
    });
  });

  // Without this the editor's sliders write state nothing renders from.
  describe('reaching the renderer', () => {
    it("projects each segment's opacities onto its mask", () => {
      const segmentation = store().ensureSegmentationForImage('img-1');
      const segment = store().createMask(
        segmentation.id,
        mintSegment({ name: 'Tumor' })
      );
      store().maskVoxels(segment.id).materialize();

      segments().updateSegment(segment.segmentId, {
        fillOpacity: 0.4,
        outlineOpacity: 0.25,
      });

      expect(store().labelmapDescriptorByMask[segment.id]).toEqual(
        expect.objectContaining({ fillOpacity: 0.4, outlineOpacity: 0.25 })
      );
    });

    // A representation redraws when its mask's list changes identity, so
    // editing one segment must not hand every other mask a new array.
    it('leaves an untouched mask its previous list', () => {
      const segmentation = store().ensureSegmentationForImage('img-1');
      const edited = store().createMask(segmentation.id, mintSegment());
      const untouched = store().createMask(segmentation.id, mintSegment());
      store().maskVoxels(edited.id).materialize();
      store().maskVoxels(untouched.id).materialize();

      const before = store().labelmapDescriptorByMask[untouched.id];
      segments().updateSegment(edited.segmentId, { fillOpacity: 0.4 });
      const after = store().labelmapDescriptorByMask;

      expect(after[untouched.id]).toBe(before);
      expect(after[edited.id]).toEqual(
        expect.objectContaining({ fillOpacity: 0.4 })
      );
    });

    // The whole projection is one watch source for the probe, so a change that
    // touched no mask must not invalidate it either.
    it('keeps the whole projection when nothing it covers changed', () => {
      const segmentation = store().ensureSegmentationForImage('img-1');
      const segment = store().createMask(segmentation.id, mintSegment());
      store().maskVoxels(segment.id).materialize();

      const before = store().labelmapDescriptorByMask;
      segments().updateSegment(segment.segmentId, { strokeWidth: 5 });

      expect(store().labelmapDescriptorByMask).toBe(before);
    });
  });
});
