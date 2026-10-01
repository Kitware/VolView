import { describe, expect, it } from 'vitest';
import { projectEnFace } from '@/src/oct/projection';
import type { ProjectionInput, SegmentationProjection } from '@/src/oct/types';

function coordinateVolume() {
  const scalars = new Float32Array(2 * 3 * 4);
  for (let z = 0; z < 4; z += 1) {
    for (let y = 0; y < 3; y += 1) {
      for (let x = 0; x < 2; x += 1) {
        scalars[x + 2 * (y + 3 * z)] = x + 10 * y + 100 * z;
      }
    }
  }
  return { scalars, dimensions: [2, 3, 4], spacing: [0.01, 0.02, 0.03] };
}

const axisCases = [
  {
    axis: 0 as const,
    width: 3,
    height: 4,
    mean: [
      0.5, 10.5, 20.5, 100.5, 110.5, 120.5, 200.5, 210.5, 220.5, 300.5, 310.5,
      320.5,
    ],
    max: [1, 11, 21, 101, 111, 121, 201, 211, 221, 301, 311, 321],
  },
  {
    axis: 1 as const,
    width: 2,
    height: 4,
    mean: [10, 11, 110, 111, 210, 211, 310, 311],
    max: [20, 21, 120, 121, 220, 221, 320, 321],
  },
  {
    axis: 2 as const,
    width: 2,
    height: 3,
    mean: [150, 151, 160, 161, 170, 171],
    max: [300, 301, 310, 311, 320, 321],
  },
];

function thicknessInput(): ProjectionInput {
  return {
    volume: {
      dimensions: [3, 1, 4],
      spacing: [0.1, 0.2, 0.01],
      scalars: new Float32Array([5, 7, 9, 15, 17, 19, 25, 27, 29, 35, 37, 39]),
    },
    axis: 2,
    method: 'mean',
    depthStart: 0,
    depthEnd: 3,
    segmentation: {
      // First A-line has a gap: occupied thickness is 2 voxels, not a 3-voxel span.
      scalars: new Uint8Array([1, 1, 0, 0, 1, 0, 1, 1, 0, 0, 0, 0]),
      dimensions: [3, 1, 4],
      thresholdMicrons: 30,
    },
  };
}

describe('OCT en face projection', () => {
  it.each(axisCases)('preserves VTK indexing along axis $axis', (testCase) => {
    const volume = coordinateVolume();
    const input = {
      volume,
      axis: testCase.axis,
      depthStart: 0,
      depthEnd: volume.dimensions[testCase.axis] - 1,
    };
    const mean = projectEnFace({ ...input, method: 'mean' });
    const maximum = projectEnFace({ ...input, method: 'max' });
    const sum = projectEnFace({ ...input, method: 'sum' });
    expect([mean.width, mean.height]).toEqual([
      testCase.width,
      testCase.height,
    ]);
    expect(Array.from(mean.values)).toEqual(testCase.mean);
    expect(Array.from(maximum.values)).toEqual(testCase.max);
    expect(Array.from(sum.values)).toEqual(
      testCase.mean.map((sample) => sample * volume.dimensions[testCase.axis])
    );
  });

  it('projects an inclusive slab and divides mean by the selected depth count', () => {
    const volume = coordinateVolume();
    const mean = projectEnFace({
      volume,
      axis: 2,
      method: 'mean',
      depthStart: 0,
      depthEnd: 1,
    });
    expect(Array.from(mean.values)).toEqual([50, 51, 60, 61, 70, 71]);
    const singleton = projectEnFace({
      volume,
      axis: 1,
      method: 'sum',
      depthStart: 2,
      depthEnd: 2,
    });
    expect(Array.from(singleton.values)).toEqual([
      20, 21, 120, 121, 220, 221, 320, 321,
    ]);
  });

  it('finds negative maxima without replacing them with zero', () => {
    const result = projectEnFace({
      volume: {
        scalars: [-5, -2, -9],
        dimensions: [1, 1, 3],
        spacing: [1, 1, 1],
      },
      axis: 2,
      method: 'max',
      depthStart: 0,
      depthEnd: 2,
    });
    expect(Array.from(result.values)).toEqual([-2]);
  });

  it('does not mutate source intensity or segment arrays', () => {
    const input = thicknessInput();
    const originalScalars = Array.from(input.volume.scalars);
    const originalLabels = Array.from(input.segmentation!.scalars);
    projectEnFace(input);
    expect(Array.from(input.volume.scalars)).toEqual(originalScalars);
    expect(Array.from(input.segmentation!.scalars)).toEqual(originalLabels);
  });

  it('omits thickness outputs when no segmentation was supplied', () => {
    const input = thicknessInput();
    const result = projectEnFace({ ...input, segmentation: undefined });
    expect(result.thicknessMicrons).toBeUndefined();
    expect(result.thinMask).toBeUndefined();
  });
});

describe('OCT segment thickness', () => {
  it('counts occupied voxels in microns and highlights only present values strictly below threshold', () => {
    const result = projectEnFace(thicknessInput());
    expect(Array.from(result.thicknessMicrons!)).toEqual([20, 30, 0]);
    expect(Array.from(result.thinMask!)).toEqual([1, 0, 0]);
  });

  it('preserves decimal physical thickness at an equal threshold', () => {
    const input = thicknessInput();
    const result = projectEnFace({
      ...input,
      volume: { ...input.volume, spacing: [0.1, 0.2, 0.0104] },
      segmentation: { ...input.segmentation!, thresholdMicrons: 20.8 },
    });
    expect(result.thicknessMicrons).toBeInstanceOf(Float64Array);
    expect(result.thicknessMicrons![0]).toBe(20.8);
    expect(result.thinMask![0]).toBe(0);
    expect(result.thicknessMicrons![0] < 20.8).toBe(false);
  });

  it('measures the full A-line even when intensity slab clips the segment', () => {
    const input = thicknessInput();
    const full = projectEnFace(input);
    const clipped = projectEnFace({ ...input, depthStart: 0, depthEnd: 0 });
    expect(Array.from(clipped.values)).toEqual([5, 7, 9]);
    expect(clipped.values).not.toEqual(full.values);
    expect(clipped.thicknessMicrons).toEqual(full.thicknessMicrons);
    expect(clipped.thinMask).toEqual(full.thinMask);
  });

  it('uses the selected label and ignores other labels', () => {
    const input = thicknessInput();
    const result = projectEnFace({
      ...input,
      segmentation: {
        ...input.segmentation!,
        scalars: new Uint8Array([2, 1, 0, 0, 2, 0, 2, 1, 0, 0, 0, 0]),
        segmentValue: 2,
      },
    });
    expect(Array.from(result.thicknessMicrons!)).toEqual([20, 10, 0]);
    expect(Array.from(result.thinMask!)).toEqual([1, 1, 0]);
  });

  it('never highlights an absent segment or a zero threshold', () => {
    const input = thicknessInput();
    expect(
      Array.from(
        projectEnFace({
          ...input,
          segmentation: { ...input.segmentation!, thresholdMicrons: 0 },
        }).thinMask!
      )
    ).toEqual([0, 0, 0]);
    expect(
      Array.from(
        projectEnFace({
          ...input,
          segmentation: { ...input.segmentation!, scalars: new Uint8Array(12) },
        }).thinMask!
      )
    ).toEqual([0, 0, 0]);
  });

  it.each([0 as const, 1 as const, 2 as const])(
    'uses physical spacing of axis %i',
    (axis) => {
      const result = projectEnFace({
        volume: {
          dimensions: [2, 2, 2],
          spacing: [0.001, 0.002, 0.004],
          scalars: new Float32Array(8),
        },
        axis,
        method: 'mean',
        depthStart: 0,
        depthEnd: 1,
        segmentation: {
          dimensions: [2, 2, 2],
          scalars: new Uint8Array(8).fill(1),
          thresholdMicrons: 10,
        },
      });
      expect(Array.from(result.thicknessMicrons!)).toEqual(
        new Array(4).fill([2, 4, 8][axis])
      );
      expect(Array.from(result.thinMask!)).toEqual([1, 1, 1, 1]);
    }
  );

  it.each([0 as const, 1 as const, 2 as const])(
    'maps a bounded mask into parent pixels on axis %i',
    (axis) => {
      const result = projectEnFace({
        volume: {
          dimensions: [4, 4, 4],
          spacing: [0.001, 0.002, 0.003],
          scalars: new Float32Array(64),
        },
        axis,
        method: 'mean',
        depthStart: 0,
        depthEnd: 0,
        segmentation: {
          dimensions: [2, 2, 2],
          extent: [1, 2, 1, 2, 1, 2],
          scalars: new Uint8Array(8).fill(1),
          thresholdMicrons: 7,
        },
      });
      const expectedThickness = new Array(16).fill(0);
      const expectedThin = new Array(16).fill(0);
      for (const index of [5, 6, 9, 10]) {
        expectedThickness[index] = [2, 4, 6][axis];
        expectedThin[index] = 1;
      }
      expect(Array.from(result.thicknessMicrons!)).toEqual(expectedThickness);
      expect(Array.from(result.thinMask!)).toEqual(expectedThin);
    }
  );

  it('maps a bounded mask whose depth range differs from the projection slab', () => {
    const input = thicknessInput();
    const result = projectEnFace({
      ...input,
      depthStart: 0,
      depthEnd: 0,
      segmentation: {
        dimensions: [1, 1, 2],
        extent: [1, 1, 0, 0, 2, 3],
        scalars: new Uint8Array([1, 1]),
        thresholdMicrons: 21,
      },
    });
    expect(Array.from(result.thicknessMicrons!)).toEqual([0, 20, 0]);
    expect(Array.from(result.thinMask!)).toEqual([0, 1, 0]);
  });
});

describe('OCT projection validation', () => {
  it.each([
    [0, 1, 4],
    [3, 1],
    [3, 1, 1.5],
    [3, 1, Infinity],
    [Number.MAX_SAFE_INTEGER, 2, 2],
  ])('rejects invalid dimensions %j', (...dimensions) => {
    const input = thicknessInput();
    expect(() =>
      projectEnFace({ ...input, volume: { ...input.volume, dimensions } })
    ).toThrow(/dimensions/);
  });

  it('rejects mismatched scalar counts and multicomponent volumes', () => {
    const input = thicknessInput();
    expect(() =>
      projectEnFace({
        ...input,
        volume: { ...input.volume, scalars: new Float32Array(11) },
      })
    ).toThrow(/scalar count/);
    expect(() =>
      projectEnFace({
        ...input,
        volume: { ...input.volume, numberOfComponents: 3 },
      })
    ).toThrow(/one scalar component/);
  });

  it.each([NaN, Infinity, -Infinity])(
    'rejects nonfinite intensity %s even outside the slab',
    (value) => {
      const input = thicknessInput();
      const scalars = Array.from(input.volume.scalars);
      scalars[11] = value;
      expect(() =>
        projectEnFace({
          ...input,
          depthEnd: 0,
          volume: { ...input.volume, scalars },
        })
      ).toThrow(/nonfinite scalar/);
    }
  );

  it.each([0, -1, NaN, Infinity])(
    'rejects invalid physical spacing %s',
    (spacing) => {
      const input = thicknessInput();
      expect(() =>
        projectEnFace({
          ...input,
          volume: { ...input.volume, spacing: [1, 1, spacing] },
        })
      ).toThrow(/positive spacings/);
    }
  );

  it.each([
    [-1, 1],
    [1, 0],
    [0, 4],
    [0.5, 1],
    [0, NaN],
  ])('rejects invalid slab %j', (depthStart, depthEnd) => {
    expect(() =>
      projectEnFace({ ...thicknessInput(), depthStart, depthEnd })
    ).toThrow(/slab/);
  });

  it('rejects unsupported axis and projection method', () => {
    const input = thicknessInput();
    expect(() =>
      projectEnFace({ ...input, axis: 3 } as unknown as ProjectionInput)
    ).toThrow(/axis/);
    expect(() =>
      projectEnFace({
        ...input,
        method: 'median',
      } as unknown as ProjectionInput)
    ).toThrow(/method/);
  });

  it.each([
    { dimensions: [3, 1, 3], scalars: new Uint8Array(9) },
    { extent: [0, 3, 0, 0, 0, 3] },
    { extent: [0, 2, 0, 0, 0, 4] },
    { extent: [-1, 1, 0, 0, 0, 3] },
    { extent: [0, 2, 0, 0, 0] },
    { extent: [0, 2, 0, 0, 0, 2.5] },
    { numberOfComponents: 2 },
    { scalars: new Float32Array(11) },
    { segmentValue: 0 },
    { segmentValue: 1.5 },
    { thresholdMicrons: -1 },
    { thresholdMicrons: Infinity },
    { scalars: new Float32Array(12).fill(NaN) },
    { scalars: new Float32Array(12).fill(0.5) },
  ])('rejects invalid segmentation %#', (invalid) => {
    const input = thicknessInput();
    const segmentation = {
      ...input.segmentation!,
      ...invalid,
    } as SegmentationProjection;
    expect(() => projectEnFace({ ...input, segmentation })).toThrow();
  });

  it('reports Float32 output overflow instead of returning unusable projection pixels', () => {
    const input = thicknessInput();
    expect(() =>
      projectEnFace({
        ...input,
        method: 'sum',
        volume: { ...input.volume, scalars: new Float32Array(12).fill(3e38) },
      })
    ).toThrow(/supported scalar range/);
  });
});
