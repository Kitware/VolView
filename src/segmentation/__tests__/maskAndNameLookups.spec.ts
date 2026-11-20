import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { computed } from 'vue';

import {
  deleteSegment,
  mintSegment,
  seatImage,
  store,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';

describe('the mask a segment is looked up through', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatImage('img-1', { name: 'CT A' });
  });

  it('answers for the segments beside one that was detached', () => {
    const [first, second, third] = ['a', 'b', 'c'].map(() =>
      mintSegment('img-1')
    );
    const masks = [first, second, third].map((segmentId) =>
      store().materializeMask(segmentId)
    );

    deleteSegment(second);

    expect(store().maskOf(first)).toBe(masks[0]);
    expect(store().maskOf(second)).toBeUndefined();
    expect(store().maskOf(third)).toBe(masks[2]);
  });

  it('reaches a computed when a mask appears and when it goes', () => {
    const segmentId = mintSegment('img-1');
    const seen = computed(() => store().maskOf(segmentId));

    expect(seen.value).toBeUndefined();
    const mask = store().materializeMask(segmentId);
    expect(seen.value).toBe(mask);

    deleteSegment(segmentId);
    expect(seen.value).toBeUndefined();
  });
});
