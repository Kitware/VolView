import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { createApp } from 'vue';
import type { Vector3 } from '@kitware/vtk.js/types';

import { CorePiniaProviderPlugin } from '@/src/core/provider';
import { rasterizePolygon } from '@/src/segmentation/editing/rasterizePolygon';
import { useSegmentStore } from '@/src/segmentation/segments';
import { useMessageStore } from '@/src/store/messages';
import { usePaintToolStore } from '@/src/store/tools/paint';
import {
  seatSpecImage as seatImage,
  store,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';

// ---------------------------------------------------------------------------
// Refusing an edit on a locked segment. The selection is shared across images
// while masks are per image, so the segment an edit aims at routinely has no
// record here yet. Resolving the target would mint that record and the
// image's segmentation, and a refusal must not leave either behind: an empty
// record reaches the saved state file and counts as a reference to the
// segment.
// ---------------------------------------------------------------------------

const SQUARE: Vector3[] = [
  [1, 1, 0],
  [3, 1, 0],
  [3, 3, 0],
  [1, 3, 0],
];

const segments = () => useSegmentStore().segments;

/** A locked segment that is selected and has no mask anywhere. */
const lockedSelection = () => {
  const segmentId = segments().mintSegment({ name: 'Locked', locked: true });
  segments().selectSegment(segmentId);
  return segmentId;
};

/** A one-voxel stroke on the K axis; unit spacing makes world points index points. */
function strokeAt(imageId: string, point: [number, number, number]) {
  const paintStore = usePaintToolStore();
  paintStore.setBrushSize(1);
  paintStore.startStroke(point, 2, imageId);
  paintStore.endStroke(point, 2, imageId);
}

const messageTitles = () =>
  useMessageStore().messages.map((message) => message.title);

/** Nothing was minted for this image: no segmentation, no record. */
const expectNothingCreated = (imageId: string, segmentId: string) => {
  expect(store().getSegmentationForImage(imageId)).toBeUndefined();
  expect(store().maskFor(imageId, segmentId)).toBeUndefined();
  expect(store().imageMasks(imageId)).toEqual([]);
};

describe('a refused edit on a locked segment', () => {
  beforeEach(async () => {
    const pinia = createPinia().use(CorePiniaProviderPlugin());
    createApp({}).use(pinia);
    setActivePinia(pinia);
    await seatImage('img-1');
  });

  it('creates no mask record for a refused stroke', () => {
    const segmentId = lockedSelection();

    strokeAt('img-1', [1, 1, 0]);

    expectNothingCreated('img-1', segmentId);
  });

  it('creates no mask record for a refused polygon', () => {
    const segmentId = lockedSelection();

    const result = rasterizePolygon({
      imageId: 'img-1',
      segmentId,
      points: SQUARE,
      slice: 0,
      viewAxis: 'Axial',
    });

    // Refused: the polygon names its segment back and no record.
    expect(result).toEqual({ segmentId, maskId: undefined });
    expect(messageTitles()).toContain('Cannot rasterize into a locked segment');
    expectNothingCreated('img-1', segmentId);
  });

  it('creates no mask record for a polygon naming a locked segment', () => {
    const locked = segments().mintSegment({ name: 'Locked', locked: true });
    const active = segments().mintSegment({ name: 'Active' });
    segments().selectSegment(active);

    const result = rasterizePolygon({
      imageId: 'img-1',
      segmentId: locked,
      points: SQUARE,
      slice: 0,
      viewAxis: 'Axial',
    });

    // The polygon carries the locked segment, so the selected one is not a
    // fallback target: nothing is created for either.
    expect(result.maskId).toBeUndefined();
    expectNothingCreated('img-1', locked);
    expect(store().maskFor('img-1', active)).toBeUndefined();
  });
});
