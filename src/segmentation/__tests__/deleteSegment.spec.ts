import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import { createSegmentRegistry } from '@/src/segmentation/segmentRegistry';
import { deleteUnlockedSegment } from '@/src/segmentation/deleteSegment';

describe('deleteUnlockedSegment', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('keeps a locked segment', () => {
    const registry = createSegmentRegistry();
    const id = registry.addSegment({ name: 'Tumor', locked: true });

    deleteUnlockedSegment(registry, id);

    expect(registry.getSegment(id)).toBeDefined();
  });

  it('deletes an unlocked segment', () => {
    const registry = createSegmentRegistry();
    const id = registry.addSegment({ name: 'Tumor' });

    deleteUnlockedSegment(registry, id);

    expect(registry.getSegment(id)).toBeUndefined();
  });
});
