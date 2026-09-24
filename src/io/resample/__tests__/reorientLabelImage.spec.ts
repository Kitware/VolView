import { describe, expect, it } from 'vitest';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import { reorientLabelImage } from '../reorientLabelImage';

const image = (dimensions: [number, number, number]) => {
  const result = vtkImageData.newInstance();
  result.setDimensions(dimensions);
  result.getPointData().setScalars(
    vtkDataArray.newInstance({
      values: Uint16Array.from(
        { length: dimensions.reduce((a, b) => a * b, 1) },
        (_, i) => i + 1
      ),
    })
  );
  return result;
};

describe('label-grid reorientation', () => {
  it.each([0, 1, 2, 3, 4, 5, 6, 7])(
    'preserves every label under axis flips %i',
    (flips) => {
      const source = image([3, 4, 5]);
      const target = image([3, 4, 5]);
      const direction: [
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
      ] = [1, 0, 0, 0, 1, 0, 0, 0, 1];
      const origin: [number, number, number] = [0, 0, 0];
      [3, 4, 5].forEach((size, axis) => {
        if (flips & (1 << axis)) {
          direction[axis * 4] = -1;
          origin[axis] = size - 1;
        }
      });
      source.setDirection(direction);
      source.setOrigin(origin);
      const output = reorientLabelImage(target, source)!;
      const values = output.getPointData().getScalars().getData();
      for (let k = 0; k < 5; k++)
        for (let j = 0; j < 4; j++)
          for (let i = 0; i < 3; i++) {
            const x = flips & 1 ? 2 - i : i,
              y = flips & 2 ? 3 - j : j,
              z = flips & 4 ? 4 - k : k;
            expect(values[i + 3 * (j + 4 * k)]).toBe(1 + x + 3 * (y + 4 * z));
          }
      expect(output.getDirection()).toEqual(target.getDirection());
      expect(source.getPointData().getScalars().getData()[0]).toBe(1);
    }
  );

  it('permutes unequal axes', () => {
    const source = image([3, 4, 5]);
    const target = image([4, 3, 5]);
    target.setDirection([0, 1, 0, 1, 0, 0, 0, 0, 1]);
    const output = reorientLabelImage(target, source)!;
    expect(output.getExtent()).toEqual(target.getExtent());
    const values = output.getPointData().getScalars().getData();
    for (let k = 0; k < 5; k++)
      for (let j = 0; j < 3; j++)
        for (let i = 0; i < 4; i++)
          expect(values[i + 4 * (j + 3 * k)]).toBe(1 + j + 3 * (i + 4 * k));
  });

  it('defers nonzero extents to the general path', () => {
    const source = image([3, 4, 5]);
    source.setExtent(1, 3, 2, 5, 3, 7);
    expect(reorientLabelImage(source, source)).toBeNull();
  });

  it('accepts DICOM precision differences without changing labels', () => {
    const source = image([3, 4, 5]);
    const target = image([3, 4, 5]);
    source.setOrigin([0.000004, 0.000004, 0.000012]);
    expect([
      ...reorientLabelImage(target, source)!
        .getPointData()
        .getScalars()
        .getData(),
    ]).toEqual([...source.getPointData().getScalars().getData()]);
  });

  it('returns the source itself when it already sits on the target grid', () => {
    const spacing: [number, number, number] = [0.7, 0.7, 3];
    const origin: [number, number, number] = [-120.1, -98.4, 33.7];
    const source = image([3, 4, 5]);
    const target = image([3, 4, 5]);
    [source, target].forEach((im) => {
      im.setSpacing(spacing);
      im.setOrigin(origin);
    });
    expect(reorientLabelImage(target, source)).toBe(source);

    // The same geometry laid out along a flipped axis is a different grid and
    // still has to go through the reslice.
    const flipped = image([3, 4, 5]);
    flipped.setSpacing(spacing);
    flipped.setOrigin([origin[0] + spacing[0] * 2, origin[1], origin[2]]);
    flipped.setDirection([-1, 0, 0, 0, 1, 0, 0, 0, 1]);
    const output = reorientLabelImage(target, flipped)!;
    expect(output).not.toBe(flipped);
    const values = output.getPointData().getScalars().getData();
    for (let k = 0; k < 5; k++)
      for (let j = 0; j < 4; j++)
        for (let i = 0; i < 3; i++)
          expect(values[i + 3 * (j + 4 * k)]).toBe(1 + (2 - i) + 3 * (j + 4 * k));
  });

  it('defers fractional shifts, different sampling, and cropping to interpolation', () => {
    const source = image([3, 4, 5]);
    const target = image([3, 4, 5]);
    source.setOrigin([0.25, 0, 0]);
    expect(reorientLabelImage(target, source)).toBeNull();
    source.setOrigin([0, 0, 0]);
    source.setSpacing([0.5, 1, 1]);
    expect(reorientLabelImage(target, source)).toBeNull();
    source.setSpacing([1, 1, 1]);
    expect(reorientLabelImage(image([1, 4, 5]), source)).toBeNull();
  });
});
