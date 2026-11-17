import { describe, expect, it } from 'vitest';
import vtkColorTransferFunction from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction';
import vtkPiecewiseFunction from '@kitware/vtk.js/Common/DataModel/PiecewiseFunction';

import {
  SEGMENT_ACTOR_OPACITY,
  SEGMENT_COINCIDENT_OFFSET,
  LABEL_TABLE_RANGE,
  labelLookupTables,
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

describe('labelLookupTables', () => {
  // The vtk.js 38 image mapper samples a 1024 texel table built with
  // getTable over the function range, at texel floor((v - lo) / (hi - lo) * W).
  const TEXELS = 1024;
  const sampledTexels = (value: number, [lo, hi]: readonly number[]) => {
    const at = ((value - lo) / (hi - lo)) * TEXELS;
    // Either neighbor when the coordinate lands on a texel boundary.
    return [...new Set([Math.floor(at - 1e-6), Math.floor(at + 1e-6)])].map(
      (texel) => Math.min(Math.max(texel, 0), TEXELS - 1)
    );
  };
  const labels = Array.from({ length: 255 }, (_, index) => ({
    value: index + 1,
    color: [index % 2 ? 0 : 255, (index * 97) % 256, index] as number[],
    fillOpacity: index % 2 ? 0.25 : 0.75,
    outlineThickness: (index % 3) + 1,
    outlineOpacity: index % 2 ? 1 : 0.5,
  }));

  it('looks up exactly each label color with no neighbor blended in', () => {
    const tables = labelLookupTables(labels);
    const colors = vtkColorTransferFunction.newInstance();
    colors.setNodes(tables.colorNodes);
    const table = new Array<number>(TEXELS * 3).fill(0);
    colors.getTable(...colors.getRange(), TEXELS, table);

    expect(colors.getRange()).toEqual([...LABEL_TABLE_RANGE]);
    labels.forEach(({ value, color }) => {
      sampledTexels(value, colors.getRange()).forEach((texel) => {
        expect(
          table
            .slice(texel * 3, texel * 3 + 3)
            .map((channel) => Math.round(channel * 255))
        ).toEqual(color);
      });
    });
  });

  it('looks up exactly each label fill opacity, and none for background', () => {
    const tables = labelLookupTables(labels);
    const opacity = vtkPiecewiseFunction.newInstance();
    opacity.setNodes(tables.opacityNodes);
    const table = new Array<number>(TEXELS).fill(0);
    const range = opacity.getRange();
    opacity.getTable(range[0], range[1], TEXELS, table);

    expect(range).toEqual([...LABEL_TABLE_RANGE]);
    sampledTexels(0, range).forEach((texel) => expect(table[texel]).toBe(0));
    labels.forEach(({ value, fillOpacity }) => {
      sampledTexels(value, range).forEach((texel) =>
        expect(table[texel]).toBeCloseTo(fillOpacity, 6)
      );
    });
  });

  it('indexes outline tables by label minus one, zero where no label is', () => {
    const tables = labelLookupTables([
      { ...labels[0], value: 3, outlineThickness: 4, outlineOpacity: 0.5 },
      { ...labels[0], value: 1, outlineThickness: 2, outlineOpacity: 1 },
    ]);

    expect(tables.thicknesses).toEqual([2, 0, 4]);
    expect(tables.opacities).toEqual([1, 0, 0.5]);
  });

  it('draws nothing without labels', () => {
    const tables = labelLookupTables([]);

    expect(tables.opacityNodes.map((node) => node.y)).toEqual([0, 0]);
    expect(tables.thicknesses).toEqual([]);
  });
});
