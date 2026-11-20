import { beforeEach, describe, expect, it } from 'vitest';
import type { Vector3 } from '@kitware/vtk.js/types';

import { rasterizePolygon } from '@/src/segmentation/editing/rasterizePolygon';
import { useSegmentStore } from '@/src/segmentation/segments';
import { messageTitles } from '@/src/components/__tests__/messageDisplay';
import {
  activateAppPinia,
  seatSpecImage,
  store,
  strokeAt,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';

// ---------------------------------------------------------------------------
// Refusing an edit on a locked segment. The selection is shared across images
// while masks are per image, so the segment an edit aims at routinely has no
// mask here yet. Resolving the target would allocate one, and a refusal must
// not leave it behind: a mask reaches the saved state file.
// ---------------------------------------------------------------------------

const SQUARE: Vector3[] = [
  [1, 1, 0],
  [3, 1, 0],
  [3, 3, 0],
  [1, 3, 0],
];

const segments = () => useSegmentStore().segments;

const lockedSelection = () => {
  const segmentId = segments().mintSegment('img-1', {
    name: 'Locked',
    locked: true,
  });
  segments().selectSegment(segmentId);
  return segmentId;
};

const expectNothingCreated = (imageId: string, segmentId: string) => {
  expect(store().maskOf(segmentId)).toBeUndefined();
  expect(store().imageMasks(imageId)).toEqual([]);
};

describe('a refused edit on a locked segment', () => {
  beforeEach(async () => {
    activateAppPinia();
    await seatSpecImage('img-1');
  });

  it('creates no mask for a refused stroke', () => {
    const segmentId = lockedSelection();

    strokeAt('img-1', [1, 1, 0]);

    expectNothingCreated('img-1', segmentId);
  });

  it('creates no mask for a refused polygon', () => {
    const segmentId = lockedSelection();

    const result = rasterizePolygon({
      imageId: 'img-1',
      segmentId,
      points: SQUARE,
      slice: 0,
      viewAxis: 'Axial',
    });

    // Refused: the polygon names its segment back.
    expect(result).toEqual({ segmentId });
    expect(messageTitles()).toContain('Cannot rasterize into a locked segment');
    expectNothingCreated('img-1', segmentId);
  });

  it('creates no mask for a polygon naming a locked segment', () => {
    const locked = segments().mintSegment('img-1', {
      name: 'Locked',
      locked: true,
    });
    const active = segments().mintSegment('img-1', { name: 'Active' });
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
    expect(result).toEqual({ segmentId: locked });
    expectNothingCreated('img-1', locked);
    expect(store().maskOf(active)).toBeUndefined();
  });
});
