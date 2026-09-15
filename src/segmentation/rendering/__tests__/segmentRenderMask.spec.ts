import { describe, expect, it } from 'vitest';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import { allocateMask, regrowMask } from '@/src/segmentation/masks/storage';
import { maskScalars, type Extent3D } from '@/src/segmentation/model';
import { segmentRenderMask } from '@/src/segmentation/rendering/renderMask';

function scene(extent: Extent3D) {
  const parent = vtkImageData.newInstance({
    spacing: [2, 3, 4],
    origin: [10, 20, 30],
    direction: [0, 1, 0, -1, 0, 0, 0, 0, 1],
  });
  parent.setExtent(4, 9, 5, 10, 6, 11);
  const source = allocateMask(parent, extent);
  maskScalars(source).fill(1);
  source.modified();
  return { parent, source };
}

describe('render-only segment slices', () => {
  it.each([0, 1, 2])('pads only the displayed plane on axis %i', (axis) => {
    const extent: Extent3D = [6, 6, 7, 7, 8, 8];
    const { parent, source } = scene(extent);
    const original = maskScalars(source);
    const origin = [...source.getOrigin()];
    const rendered = segmentRenderMask(source, parent, extent, {
      axis: axis,
      index: extent[axis * 2],
    })!;
    const dimensions = [3, 3, 3];
    dimensions[axis] = 1;
    expect(rendered.getDimensions()).toEqual(dimensions);
    const center: [number, number, number] = [1, 1, 1];
    center[axis] = 0;
    expect(Array.from(rendered.indexToWorld(center))).toEqual(origin);
    expect([...maskScalars(rendered)]).toEqual([0, 0, 0, 0, 1, 0, 0, 0, 0]);
    expect(source.getDimensions()).toEqual([1, 1, 1]);
    expect(source.getOrigin()).toEqual(origin);
    expect(maskScalars(source)).toBe(original);
    expect([...original]).toEqual([1]);
    expect(
      segmentRenderMask(source, parent, extent, {
        axis: axis,
        index: extent[axis * 2] + 1,
      })
    ).toBeNull();
    expect(
      segmentRenderMask(source, parent, [0, -1, 0, -1, 0, -1], {
        axis: axis,
        index: 0,
      })
    ).toBeNull();
  });

  it.each([0, 1, 2, 3, 4, 5])('clips padding at parent face %i', (face) => {
    const extent: Extent3D = [6, 6, 7, 7, 8, 8];
    const bounds = [4, 9, 5, 10, 6, 11];
    const boundaryAxis = Math.floor(face / 2);
    const axis = (boundaryAxis + 1) % 3;
    extent[boundaryAxis * 2] = bounds[face];
    extent[boundaryAxis * 2 + 1] = bounds[face];
    const { parent, source } = scene(extent);
    const rendered = segmentRenderMask(source, parent, extent, {
      axis: axis,
      index: extent[axis * 2],
    })!;
    expect(rendered.getDimensions()[boundaryAxis]).toBe(2);
    const corner: [number, number, number] = [0, 0, 0];
    if (face % 2) corner[boundaryAxis] = 1;
    expect(
      parent.worldToIndex(rendered.indexToWorld(corner))[boundaryAxis]
    ).toBeCloseTo(bounds[face]);
    expect([...maskScalars(rendered)].reduce((a, b) => a + b, 0)).toBe(1);
  });

  it('refreshes after edits, slice changes and growth', () => {
    const extent: Extent3D = [6, 6, 7, 7, 8, 9];
    const { parent, source } = scene(extent);
    const first = segmentRenderMask(source, parent, extent, {
      axis: 2,
      index: 8,
    })!;
    expect(
      segmentRenderMask(source, parent, extent, { axis: 2, index: 8 })
    ).toBe(first);
    maskScalars(source)[0] = 0;
    source.modified();
    expect(
      segmentRenderMask(source, parent, extent, { axis: 2, index: 8 })
    ).toBe(first);
    expect([...maskScalars(first)].every((v) => v === 0)).toBe(true);
    expect(first.getPointData().getScalars().getRange()).toEqual([0, 0]);
    const nextSlice = segmentRenderMask(source, parent, extent, {
      axis: 2,
      index: 9,
    })!;
    expect([...maskScalars(nextSlice)]).toEqual([0, 0, 0, 0, 1, 0, 0, 0, 0]);
    expect(
      Array.from(parent.worldToIndex(nextSlice.indexToWorld([1, 1, 0])))
    ).toEqual([6, 7, 9]);
    const grown: Extent3D = [5, 6, 7, 7, 8, 9];
    regrowMask(source, parent, extent, grown);
    maskScalars(source)[0] = 1;
    source.modified();
    const next = segmentRenderMask(source, parent, grown, {
      axis: 2,
      index: 8,
    })!;
    expect(next.getDimensions()).toEqual([4, 3, 1]);
    expect(next.getPointData().getScalars().getRange()).toEqual([0, 1]);
    expect([...maskScalars(next)].reduce((a, b) => a + b, 0)).toBe(1);
  });
});
