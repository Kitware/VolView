import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

import { useFillBetweenStore } from '@/src/store/tools/fillBetween';
import { useGaussianSmoothStore } from '@/src/store/tools/gaussianSmooth';
import {
  addSegment,
  seatImage,
  seedVoxel,
  store,
} from '@/src/store/__tests__/segmentMaskFixtures';

// A process that writes one label value cannot run against an image-scoped
// target: with no segment to write, it refuses instead of touching the
// background.

async function seatImageTarget() {
  await seatImage('image-1');
  const segmentId = addSegment('image-1', 'Tumor');
  seedVoxel(segmentId, [1, 1, 1]);
  return {
    scope: 'image' as const,
    parentImageId: 'image-1',
    voxels: store().imageVoxels('image-1'),
  };
}

describe('single-label processes reject an image-scoped target', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('fill between needs an active segment', async () => {
    const target = await seatImageTarget();

    await expect(
      useFillBetweenStore().computeAlgorithm(target)
    ).rejects.toThrow(/active segment/i);
  });

  it('gaussian smooth needs an active segment', async () => {
    const target = await seatImageTarget();

    await expect(
      useGaussianSmoothStore().computeAlgorithm(target)
    ).rejects.toThrow(/active segment/i);
  });
});
