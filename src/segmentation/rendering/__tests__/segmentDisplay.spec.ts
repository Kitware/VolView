import { describe, expect, it } from 'vitest';

import {
  SEGMENT_ACTOR_OPACITY,
  SEGMENT_COINCIDENT_OFFSET,
  segmentFillAlpha,
  segmentOutline,
} from '@/src/segmentation/rendering/display';
import { SEGMENT_VALUE } from '@/src/segmentation/masks/labelValue';
import type { ResolvedLabelmapSegment } from '@/src/segmentation/model';

const segment = (
  overrides: Partial<ResolvedLabelmapSegment> = {}
): ResolvedLabelmapSegment => ({
  value: SEGMENT_VALUE,
  name: 'Segment',
  color: [255, 0, 0, 255],
  visible: true,
  locked: false,
  fillOpacity: 1,
  outlineOpacity: 1,
  ...overrides,
});

describe('segmentFillAlpha', () => {
  it('is the segment alpha when the fill is fully opaque', () => {
    expect(
      segmentFillAlpha(segment({ color: [255, 0, 0, 51] }), 1)
    ).toBeCloseTo(0.2);
  });

  it('scales the segment alpha by the fill opacity', () => {
    expect(
      segmentFillAlpha(segment({ color: [255, 0, 0, 51], fillOpacity: 0.5 }), 1)
    ).toBeCloseTo(0.1);
  });

  it('hides a segment with zero color alpha', () => {
    expect(segmentFillAlpha(segment({ color: [255, 0, 0, 0] }), 1)).toBe(0);
  });

  it('hides a fill the user set to zero', () => {
    expect(segmentFillAlpha(segment({ fillOpacity: 0 }), 1)).toBe(0);
  });

  it('hides an invisible segment whatever its fill opacity', () => {
    expect(
      segmentFillAlpha(segment({ visible: false, fillOpacity: 1 }), 1)
    ).toBe(0);
  });

  it("scales the segment alpha by the segmentation's fill opacity", () => {
    expect(segmentFillAlpha(segment({ fillOpacity: 0.5 }), 0.5)).toBe(0.25);
  });

  it("hides every fill when the segmentation's fill opacity is zero", () => {
    expect(segmentFillAlpha(segment({ fillOpacity: 1 }), 0)).toBe(0);
  });
});

describe('segmentOutline', () => {
  it('hides an outline the user set to zero', () => {
    const tables = segmentOutline(segment({ outlineOpacity: 0 }), 2, 1);

    expect(tables.opacities).toEqual([0]);
  });

  it('scales the segment by the segmentation outline opacity', () => {
    const tables = segmentOutline(segment({ outlineOpacity: 0.5 }), 2, 0.5);

    expect(tables.opacities).toEqual([0.25]);
  });

  it('keeps the thickness of a visible segment', () => {
    expect(segmentOutline(segment(), 2, 1).thicknesses).toEqual([2]);
  });

  it('drops the thickness of an invisible segment', () => {
    const tables = segmentOutline(segment({ visible: false }), 2, 1);

    expect(tables.thicknesses).toEqual([0]);
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

describe('SEGMENT_COINCIDENT_OFFSET', () => {
  it('uses negative offsets to put segments in front of the base image', () => {
    const [factor, units] = SEGMENT_COINCIDENT_OFFSET;
    expect(factor).toBeLessThan(0);
    expect(units).toBeLessThan(0);
  });
});
