import { describe, expect, it } from 'vitest';
import { projectEnFace } from '@/src/oct/projection';
import {
  projectionWindowRanges,
  paintProjectionIntensities,
  paintThinRegionPixels,
} from '@/src/oct/windowLevel';

function input() {
  return {
    volume: {
      dimensions: [3, 3, 2],
      spacing: [0.01, 0.004, 0.1],
      scalars: Float64Array.from([
        10, 0, 100, 65535, 0, 101, 30, 65535, 65535, 65535, 50, 10, 65535, 60,
        11, 65535, 70, 12,
      ]),
      paddingRanges: [{ firstFrame: 0, lastFrame: 1, min: 65535, max: 65535 }],
    },
    axis: 1 as const,
    method: 'mean' as const,
    depthStart: 0,
    depthEnd: 2,
  };
}

function mask() {
  return {
    dimensions: [3, 3, 2],
    scalars: Uint8Array.from([
      1, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0, 0, 1, 0,
    ]),
    thresholdMicrons: 9,
  };
}

describe('Declared OCT padding', () => {
  it.each([
    ['mean', [20, 0, 100.5, 0, 60, 11]],
    ['max', [30, 0, 101, 0, 70, 12]],
    ['sum', [40, 0, 201, 0, 180, 33]],
  ] as const)(
    'excludes padding from %s while preserving measured zeros',
    (method, expected) => {
      const result = projectEnFace({ ...input(), method });
      expect(Array.from(result.values)).toEqual(expected);
      expect(Array.from(result.validPixels!)).toEqual([1, 1, 1, 0, 1, 1]);
    }
  );

  it('keeps unknown mask thickness distinct from absent labels and independently of the slab', () => {
    const request = { ...input(), segmentation: mask() };
    const full = projectEnFace(request);
    expect(Array.from(full.thicknessMicrons!)).toEqual([NaN, 8, 4, NaN, 12, 0]);
    expect(Array.from(full.thinMask!)).toEqual([0, 1, 1, 0, 0, 0]);
    const slab = projectEnFace({ ...request, depthEnd: 0 });
    expect(slab.thicknessMicrons).toEqual(full.thicknessMicrons);
    expect(slab.values[0]).toBe(10);
    expect(slab.validPixels![0]).toBe(1);
    expect(request.segmentation.scalars).toEqual(mask().scalars);
  });

  it('maps a bounded mask into parent coordinates before checking padding', () => {
    const result = projectEnFace({
      ...input(),
      segmentation: {
        dimensions: [1, 2, 1],
        extent: [0, 0, 1, 2, 0, 0],
        scalars: Uint8Array.from([1, 1]),
        thresholdMicrons: 9,
      },
    });
    expect(Array.from(result.thicknessMicrons!)).toEqual([NaN, 0, 0, 0, 0, 0]);
    expect(Array.from(result.thinMask!)).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('uses the source frame of every sample for projections along Z and X', () => {
    const z = projectEnFace({ ...input(), axis: 2, depthEnd: 1 });
    expect(Array.from(z.values)).toEqual([10, 25, 55, 0, 30, 56, 30, 70, 12]);
    expect(Array.from(z.validPixels!)).toEqual([1, 1, 1, 0, 1, 1, 1, 1, 1]);
    const x = projectEnFace({ ...input(), axis: 0 });
    expect(Array.from(x.values)).toEqual([
      Math.fround(110 / 3),
      50.5,
      30,
      30,
      35.5,
      41,
    ]);
  });

  it('allows inclusive signed ranges that differ between source frames', () => {
    const request = input();
    request.volume.scalars = Float64Array.from([
      -10, -11, -8, -9, 0, 10, 20, 0, 20, 200, 201, 0, 202, 0, 0, 10, 10, 10,
    ]);
    request.volume.paddingRanges = [
      { firstFrame: 0, lastFrame: 0, min: -10, max: -9 },
      { firstFrame: 1, lastFrame: 1, min: 200, max: 202 },
    ];
    const result = projectEnFace(request);
    expect(Array.from(result.values)).toEqual([
      20,
      Math.fround(-11 / 3),
      Math.fround(22 / 3),
      10,
      5,
      Math.fround(10 / 3),
    ]);
    expect(Array.from(result.validPixels!)).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it('rejects an entirely padded slab and malformed or overlapping declarations', () => {
    const request = input();
    request.volume.scalars.fill(65535);
    expect(() => projectEnFace(request)).toThrow(/only padding/);
    for (const range of [
      { firstFrame: -1, lastFrame: 1, min: 0, max: 1 },
      { firstFrame: 0, lastFrame: 2, min: 0, max: 1 },
      { firstFrame: 0, lastFrame: 1, min: 1, max: 0 },
      { firstFrame: 0, lastFrame: 1, min: NaN, max: 1 },
    ]) {
      expect(() =>
        projectEnFace({
          ...input(),
          volume: { ...input().volume, paddingRanges: [range] },
        })
      ).toThrow(/padding/);
    }
    const duplicate = input();
    duplicate.volume.paddingRanges.push({
      ...duplicate.volume.paddingRanges[0],
    });
    expect(() => projectEnFace(duplicate)).toThrow(/overlap/);
  });

  it('excludes missing pixels from contrast and keeps missing areas black', () => {
    const values = Float32Array.from([0, 100, 200]);
    const valid = Uint8Array.from([0, 1, 1]);
    expect(projectionWindowRanges(values, valid)?.ranges.FullRange).toEqual([
      100, 200,
    ]);
    expect(projectionWindowRanges(values, new Uint8Array(3))).toBeNull();
    const pixels = new Uint8ClampedArray(12);
    paintProjectionIntensities(values, pixels, { width: 200, level: 0 }, valid);
    expect(Array.from(pixels)).toEqual([
      0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255,
    ]);
    expect(
      paintThinRegionPixels(pixels, [4, 0, 4], 5, {
        color: [0, 255, 0, 255],
        alpha: 1,
        validPixels: valid,
      })
    ).toBe(1);
    expect(Array.from(pixels.slice(0, 4))).toEqual([0, 0, 0, 255]);
    expect(Array.from(pixels.slice(8, 12))).toEqual([0, 255, 0, 255]);
  });
});
