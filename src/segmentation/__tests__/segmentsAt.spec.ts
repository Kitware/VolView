import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import {
  addMask,
  seatSpecImage,
  seedVoxel,
  segmentOfMask,
  store,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';

// The eyedropper and the probe both ask which segments hold a voxel, so they
// cannot disagree about one.
describe('the segments holding a voxel', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatSpecImage('img-1');
  });

  it('lists every covering segment in registry order', () => {
    const first = addMask('img-1', 'First');
    const second = addMask('img-1', 'Second');
    const elsewhere = addMask('img-1', 'Elsewhere');
    seedVoxel(second, [1, 1, 0]);
    seedVoxel(first, [1, 1, 0]);
    seedVoxel(elsewhere, [2, 2, 1]);

    expect(store().segmentsAt('img-1', 1, 1, 0)).toEqual([
      segmentOfMask(first),
      segmentOfMask(second),
    ]);
  });

  it('finds nothing where no mask holds the voxel', () => {
    seedVoxel(addMask('img-1', 'Only'), [1, 1, 0]);

    expect(store().segmentsAt('img-1', 0, 0, 0)).toEqual([]);
    expect(store().segmentsAt('img-1', -1, 1, 0)).toEqual([]);
    expect(store().segmentsAt('other', 1, 1, 0)).toEqual([]);
  });
});
