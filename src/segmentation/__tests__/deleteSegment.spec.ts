import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import { createSegmentRegistry } from '@/src/segmentation/segmentRegistry';
import { deleteSegmentAndReport } from '@/src/segmentation/deleteSegment';

describe('deleteSegmentAndReport', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('keeps a locked segment', () => {
    const registry = createSegmentRegistry();
    const id = registry.addSegment({ name: 'Tumor', locked: true });

    deleteSegmentAndReport(registry, id);

    expect(registry.getSegment(id)).toBeDefined();
  });

  it('deletes an unlocked segment', () => {
    const registry = createSegmentRegistry();
    const id = registry.addSegment({ name: 'Tumor' });

    deleteSegmentAndReport(registry, id);

    expect(registry.getSegment(id)).toBeUndefined();
  });
});
