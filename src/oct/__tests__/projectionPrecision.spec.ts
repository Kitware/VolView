import { describe, expect, it } from 'vitest';
import { projectEnFace } from '@/src/oct/projection';
import { prepareScalarPlane, scalarWindow } from '@/src/core/vtk/scalarPlane';
import { imageWindowRanges } from '@/src/utils/imageWindowing';
import type { ProjectionMethod } from '@/src/oct/types';

describe('OCT projection intensity precision', () => {
  it.each([
    {
      source: Float32Array.from([33554432, 33554432, 33554432, 33554436]),
      expected: [33554432, 33554434],
      residuals: [0, 2],
      level: 33554433,
    },
    {
      source: Float32Array.from([-33554432, -33554432, -33554432, -33554436]),
      expected: [-33554432, -33554434],
      residuals: [0, -2],
      level: -33554433,
    },
  ])('preserves the intermediate Float32 mean $level', (testCase) => {
    const source = Array.from(testCase.source);
    const result = projectEnFace({
      volume: {
        scalars: testCase.source,
        dimensions: [2, 2, 1],
        spacing: [1, 1, 1],
      },
      axis: 1,
      method: 'mean',
      depthStart: 0,
      depthEnd: 1,
    });
    expect(Array.from(result.values)).toEqual(testCase.expected);
    expect(imageWindowRanges(result.values)?.ranges.FullRange).toEqual([
      Math.min(...testCase.expected),
      Math.max(...testCase.expected),
    ]);
    const plane = prepareScalarPlane(result.values);
    expect(Array.from(plane.scalars)).toEqual(testCase.residuals);
    expect(
      scalarWindow({ width: 2, level: testCase.level }, plane.offset)
    ).toEqual({
      width: 2,
      level: testCase.residuals[1] / 2,
    });
    expect(Array.from(testCase.source)).toEqual(source);
  });

  it.each([
    { method: 'mean', expected: [1073741824, 1073741824.25], delta: 0.25 },
    { method: 'max', expected: [1073741824, 1073741824.25], delta: 0.25 },
    { method: 'sum', expected: [2147483648, 2147483648.5], delta: 0.5 },
  ] satisfies {
    method: ProjectionMethod;
    expected: number[];
    delta: number;
  }[])(
    'preserves nearby Float64 source intensities for $method',
    ({ method, expected, delta }) => {
      const result = projectEnFace({
        volume: {
          scalars: Float64Array.from([
            1073741824, 1073741824.25, 1073741824, 1073741824.25,
          ]),
          dimensions: [2, 2, 1],
          spacing: [1, 1, 1],
        },
        axis: 1,
        method,
        depthStart: 0,
        depthEnd: 1,
      });
      expect(Array.from(result.values)).toEqual(expected);
      expect(imageWindowRanges(result.values)?.ranges.FullRange).toEqual(
        expected
      );
      expect(Array.from(prepareScalarPlane(result.values).scalars)).toEqual([
        0,
        delta,
      ]);
    }
  );
});
