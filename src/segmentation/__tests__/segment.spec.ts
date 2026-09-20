import { describe, expect, it } from 'vitest';

import { resolveSegmentAppearance } from '@/src/segmentation/segment';

describe('the appearance resolver', () => {
  it('fills the app defaults for what a segment leaves unset', () => {
    const resolved = resolveSegmentAppearance({
      id: 'segment-1',
      name: 'Tumor',
      color: [255, 0, 0, 255],
      visible: true,
      locked: false,
    });

    expect(resolved).toMatchObject({
      name: 'Tumor',
      cssColor: '#ff0000',
      fillOpacity: 1,
      outlineOpacity: 1,
    });
  });

  it('keeps what a segment does state', () => {
    const resolved = resolveSegmentAppearance({
      id: 'segment-1',
      name: 'Tumor',
      color: [255, 0, 0, 255],
      visible: false,
      locked: true,
      fillOpacity: 0.25,
      strokeWidth: 3,
    });

    expect(resolved.fillOpacity).toBe(0.25);
    expect(resolved.strokeWidth).toBe(3);
    expect(resolved.visible).toBe(false);
    expect(resolved.locked).toBe(true);
  });

  it('answers for a segment that is gone', () => {
    const resolved = resolveSegmentAppearance(undefined);

    expect(resolved.name).toBe('');
    expect(resolved.fillOpacity).toBe(1);
    expect(resolved.visible).toBe(true);
    expect(resolved.locked).toBe(false);
  });
});
