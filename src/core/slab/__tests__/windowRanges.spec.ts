import { describe, expect, it } from 'vitest';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import { slabWindowRanges } from '../windowRanges';

function constantDepthRanges(
  spacing: number[],
  first = 0,
  last = 2,
  values = [100, 200]
) {
  const image = vtkImageData.newInstance();
  image.setDimensions([2, 3, 2]);
  image.setSpacing(spacing);
  const scalars = vtkDataArray.newInstance({
    values: Float32Array.from({ length: 12 }, (_, index) =>
      index % 2 ? values[1] : values[0]
    ),
    numberOfComponents: 1,
  });
  image.getPointData().setScalars(scalars);
  try {
    return slabWindowRanges(image, { axis: 1, first, last, method: 'sum' })!;
  } finally {
    image.delete();
    scalars.delete();
  }
}

describe('Sum projection contrast sampling', () => {
  it.each([
    ['decimal endpoint', [0.01, 0.01, 0.06], 5],
    ['signed decimal endpoint', [-0.01, 0.01, 0.06], 5],
    ['exact binary endpoint', [0.125, 0.125, 0.75], 5],
    ['endpoint within shader tolerance', [0.01, 0.010000001, 0.06], 5],
    ['endpoint beyond shader tolerance', [0.01, 0.01000001, 0.06], 7],
    ['noninteger physical ratio', [0.01, 0.011, 0.06], 7],
  ] as const)(
    'uses the rendered sample count for %s',
    (_name, spacing, sampleCount) => {
      // Each ray is constant, so its sum is its intensity times the sample count.
      const ranges = constantDepthRanges([...spacing]);
      for (const preset of [
        'LowContrast',
        'MediumContrast',
        'HighContrast',
      ] as const)
        expect(ranges[preset]).toEqual([100 * sampleCount, 200 * sampleCount]);
      expect(ranges.FullRange).toEqual([0, 200 * sampleCount]);
    }
  );

  it('uses one sample for a single selected depth', () => {
    const ranges = constantDepthRanges([0.01, 0.01, 0.06], 1, 1);
    expect(ranges.LowContrast).toEqual([100, 200]);
  });

  it.each([
    [-3024, 3071],
    [-200, -100],
  ])('bounds raw signed sums for source range %s..%s', (min, max) => {
    const ranges = constantDepthRanges([1, 1, 1], 0, 2, [min, max]);
    expect(ranges.FullRange).toEqual([
      Math.min(0, min * 5),
      Math.max(0, max * 5),
    ]);
  });
});
