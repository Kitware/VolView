import { beforeEach, describe, expect, it } from 'vitest';
import { effectScope } from 'vue';

import { useMaskRevision } from '@/src/segmentation/composables/useMaskRevision';
import { confineWrites } from '@/src/segmentation/masks/writeRegion';
import { extentReachesSlice } from '@/src/segmentation/geometry';
import {
  SPEC_FULL_EXTENT,
  activateAppPinia,
  addSegment,
  seatSpecImage,
  store,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';

describe('useMaskRevision', () => {
  beforeEach(async () => {
    activateAppPinia();
    await seatSpecImage('img-1');
  });

  it('skips writes confined to a region its consumer is not showing', () => {
    const voxels = store().maskVoxels(addSegment('img-1', 'Tumor'));
    voxels.materialize();
    voxels.ensureContains(SPEC_FULL_EXTENT);
    const scope = effectScope();
    const revision = scope.run(() =>
      useMaskRevision(
        () => 'img-1',
        (region) => extentReachesSlice(region, 2, 0)
      )
    )!;
    const write = () => voxels.image().modified();
    const counted = () => revision.value;
    const start = counted();

    confineWrites([0, 3, 0, 3, 1, 1], write);
    expect(counted()).toBe(start);

    confineWrites([1, 2, 0, 3, 0, 1], write);
    expect(counted()).toBe(start + 1);

    write();
    expect(counted()).toBe(start + 2);
    scope.stop();
  });
});
