import { describe, expect, it } from 'vitest';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import { allocateMask, regrowMask } from '@/src/store/segmentMask';
import { maskScalars, type Extent3D } from '@/src/types/segmentation';
import { segmentRenderMask } from '../segmentRenderMask';

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

describe('render-only segment padding', () => {
  it('does not copy a full-volume mask or allocate an empty mask', () => {
    const extent: Extent3D = [4, 9, 5, 10, 6, 11];
    const { parent, source } = scene(extent);
    expect(segmentRenderMask(source, parent, extent)).toBe(source);
    expect(segmentRenderMask(source, parent, [0, -1, 0, -1, 0, -1])).toBeNull();
  });

  it('pads an interior voxel without changing stored export geometry or values', () => {
    const extent: Extent3D = [6, 6, 7, 7, 8, 8];
    const { parent, source } = scene(extent);
    const original = maskScalars(source);
    const origin = [...source.getOrigin()];
    const rendered = segmentRenderMask(source, parent, extent)!;
    expect(rendered.getDimensions()).toEqual([3, 3, 3]);
    expect(Array.from(rendered.indexToWorld([1, 1, 1]))).toEqual(origin);
    expect([...maskScalars(rendered)]).toEqual(
      Array.from({ length: 27 }, (_, i) => (i === 13 ? 1 : 0))
    );
    expect(source.getDimensions()).toEqual([1, 1, 1]);
    expect(source.getOrigin()).toEqual(origin);
    expect(maskScalars(source)).toBe(original);
    expect([...original]).toEqual([1]);
    expect(extent).toEqual([6, 6, 7, 7, 8, 8]);
  });

  it.each([0, 1, 2, 3, 4, 5])('clips padding at parent face %i', (face) => {
    const extent: Extent3D = [6, 6, 7, 7, 8, 8];
    const bounds = [4, 9, 5, 10, 6, 11];
    const axis = Math.floor(face / 2);
    extent[axis * 2] = bounds[face];
    extent[axis * 2 + 1] = bounds[face];
    const { parent, source } = scene(extent);
    const rendered = segmentRenderMask(source, parent, extent)!;
    expect(rendered.getDimensions()[axis]).toBe(2);
    const corner: [number, number, number] = [0, 0, 0];
    if (face % 2) corner[axis] = 1;
    expect(
      parent.worldToIndex(rendered.indexToWorld(corner))[axis]
    ).toBeCloseTo(bounds[face]);
    expect([...maskScalars(rendered)].reduce((a, b) => a + b, 0)).toBe(1);
  });

  it('shares the padded image between views and refreshes after edits and growth', () => {
    const extent: Extent3D = [6, 6, 7, 7, 8, 8];
    const { parent, source } = scene(extent);
    const first = segmentRenderMask(source, parent, extent)!;
    const scalars = maskScalars(first);
    const dataArray = first.getPointData().getScalars();
    const mtime = first.getMTime();
    expect(dataArray.getRange()).toEqual([0, 1]);
    expect(segmentRenderMask(source, parent, extent)).toBe(first);
    expect(maskScalars(first)).toBe(scalars);
    maskScalars(source)[0] = 0;
    source.modified();
    expect(segmentRenderMask(source, parent, extent)).toBe(first);
    expect(maskScalars(first)).toBe(scalars);
    expect(first.getPointData().getScalars()).toBe(dataArray);
    expect(first.getMTime()).toBeGreaterThan(mtime);
    expect([...maskScalars(first)].every((v) => v === 0)).toBe(true);
    expect(dataArray.getRange()).toEqual([0, 0]);
    maskScalars(source)[0] = 1;
    source.modified();
    segmentRenderMask(source, parent, extent);
    expect(dataArray.getRange()).toEqual([0, 1]);
    expect([...scalars]).toEqual(
      Array.from({ length: 27 }, (_, i) => (i === 13 ? 1 : 0))
    );
    maskScalars(source)[0] = 0;
    source.modified();
    const grown: Extent3D = [5, 6, 7, 7, 8, 8];
    regrowMask(source, parent, extent, grown);
    maskScalars(source)[0] = 1;
    source.modified();
    const next = segmentRenderMask(source, parent, grown)!;
    expect(maskScalars(next)).not.toBe(scalars);
    expect(next.getPointData().getScalars().getRange()).toEqual([0, 1]);
    expect(next.getDimensions()).toEqual([4, 3, 3]);
    expect(Array.from(next.indexToWorld([1, 1, 1]))).toEqual(
      Array.from(source.getOrigin())
    );
    expect([...maskScalars(next)].reduce((a, b) => a + b, 0)).toBe(1);
  });
});
