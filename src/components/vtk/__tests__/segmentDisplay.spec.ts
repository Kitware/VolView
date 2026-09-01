import { describe, expect, it } from 'vitest';

import {
  segmentFillAlpha,
  segmentOutlineTables,
} from '@/src/components/vtk/segmentDisplay';
import type { LabelmapSegment } from '@/src/types/segmentation';

const makeSegment = (
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
    expect(segmentFillAlpha(makeSegment(1, { fillOpacity: 1 }))).toBe(1);
  });

  it('scales the segment alpha by the fill opacity', () => {
    expect(segmentFillAlpha(makeSegment(1, { fillOpacity: 0.5 }))).toBe(0.5);
  });

  it('hides a fill the user set to zero', () => {
    expect(segmentFillAlpha(makeSegment(1, { fillOpacity: 0 }))).toBe(0);
  });

  it('hides an invisible segment whatever its fill opacity', () => {
    expect(
      segmentFillAlpha(makeSegment(1, { visible: false, fillOpacity: 1 }))
    ).toBe(0);
  });

  it('treats a descriptor without a fill opacity as opaque', () => {
    expect(segmentFillAlpha(makeSegment(1))).toBe(1);
  });
});

describe('segmentOutlineTables', () => {
  it('indexes both tables by label value minus one', () => {
    const tables = segmentOutlineTables(
      [
        makeSegment(1, { outlineOpacity: 0.25 }),
        makeSegment(2, { outlineOpacity: 0.5 }),
      ],
      2,
      1
    );

    expect(tables.opacities).toEqual([0.25, 0.5]);
    expect(tables.thicknesses).toEqual([2, 2]);
  });

  it('hides an outline the user set to zero', () => {
    const tables = segmentOutlineTables(
      [makeSegment(1, { outlineOpacity: 0 })],
      2,
      1
    );

    expect(tables.opacities).toEqual([0]);
  });

  it('scales every segment by the group outline opacity', () => {
    const tables = segmentOutlineTables(
      [makeSegment(1, { outlineOpacity: 0.5 })],
      2,
      0.5
    );

    expect(tables.opacities).toEqual([0.25]);
  });

  it('leaves values no segment claims at the group defaults', () => {
    const tables = segmentOutlineTables(
      [makeSegment(3, { outlineOpacity: 0.5 })],
      2,
      1
    );

    expect(tables.opacities).toEqual([1, 1, 0.5]);
    expect(tables.thicknesses).toEqual([2, 2, 2]);
  });

  it('drops the thickness of an invisible segment', () => {
    const tables = segmentOutlineTables(
      [makeSegment(1, { visible: false }), makeSegment(2)],
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
