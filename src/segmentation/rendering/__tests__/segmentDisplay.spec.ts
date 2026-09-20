import { describe, expect, it } from 'vitest';

import {
  SEGMENT_ACTOR_OPACITY,
  segmentFillAlpha,
  segmentOutlineTables,
} from '@/src/segmentation/rendering/display';
import type { LabelmapSegment } from '@/src/segmentation/model';

const makeMask = (
  value: number,
  overrides: Partial<LabelmapSegment> = {}
): LabelmapSegment => ({
  value,
  name: `Segment ${value}`,
  color: [255, 0, 0, 255],
  visible: true,
  ...overrides,
});

describe('segmentFillAlpha', () => {
  it('is the segment alpha when the fill is fully opaque', () => {
    expect(segmentFillAlpha(makeMask(1, { fillOpacity: 1 }))).toBe(1);
  });

  it('scales the segment alpha by the fill opacity', () => {
    expect(segmentFillAlpha(makeMask(1, { fillOpacity: 0.5 }))).toBe(0.5);
  });

  it('hides a fill the user set to zero', () => {
    expect(segmentFillAlpha(makeMask(1, { fillOpacity: 0 }))).toBe(0);
  });

  it('hides an invisible segment whatever its fill opacity', () => {
    expect(
      segmentFillAlpha(makeMask(1, { visible: false, fillOpacity: 1 }))
    ).toBe(0);
  });

  it('treats a descriptor without a fill opacity as opaque', () => {
    expect(segmentFillAlpha(makeMask(1))).toBe(1);
  });

  it('scales the segment alpha by the segmentation\u2019s fill opacity', () => {
    expect(segmentFillAlpha(makeMask(1, { fillOpacity: 0.5 }), 0.5)).toBe(0.25);
  });

  it('hides every fill when the segmentation\u2019s fill opacity is zero', () => {
    expect(segmentFillAlpha(makeMask(1, { fillOpacity: 1 }), 0)).toBe(0);
  });
});

describe('segmentOutlineTables', () => {
  it('indexes both tables by label value minus one', () => {
    const tables = segmentOutlineTables(
      [
        makeMask(1, { outlineOpacity: 0.25 }),
        makeMask(2, { outlineOpacity: 0.5 }),
      ],
      2,
      1
    );

    expect(tables.opacities).toEqual([0.25, 0.5]);
    expect(tables.thicknesses).toEqual([2, 2]);
  });

  it('hides an outline the user set to zero', () => {
    const tables = segmentOutlineTables(
      [makeMask(1, { outlineOpacity: 0 })],
      2,
      1
    );

    expect(tables.opacities).toEqual([0]);
  });

  it('scales every segment by the group outline opacity', () => {
    const tables = segmentOutlineTables(
      [makeMask(1, { outlineOpacity: 0.5 })],
      2,
      0.5
    );

    expect(tables.opacities).toEqual([0.25]);
  });

  it('leaves values no segment claims at the group defaults', () => {
    const tables = segmentOutlineTables(
      [makeMask(3, { outlineOpacity: 0.5 })],
      2,
      1
    );

    expect(tables.opacities).toEqual([1, 1, 0.5]);
    expect(tables.thicknesses).toEqual([2, 2, 2]);
  });

  it('drops the thickness of an invisible segment', () => {
    const tables = segmentOutlineTables(
      [makeMask(1, { visible: false }), makeMask(2)],
      2,
      1
    );

    expect(tables.thicknesses).toEqual([0, 2]);
  });

  it('has no entries for an artifact with no bound segments', () => {
    expect(segmentOutlineTables([], 2, 1)).toEqual({
      thicknesses: [],
      opacities: [],
    });
  });
});

describe('SEGMENT_ACTOR_OPACITY', () => {
  it('leaves the fill to the transfer functions', () => {
    // A fully opaque segment reaches the screen at its own alpha, so the actor
    // must not scale it down.
    expect(SEGMENT_ACTOR_OPACITY).toBeGreaterThan(0.999);
  });

  it('stays out of the opaque render pass', () => {
    // vtk.js treats an image slice at opacity 1 as opaque and restacks it
    // against the base image and the sibling segment actors.
    expect(SEGMENT_ACTOR_OPACITY).toBeLessThan(1);
  });
});
