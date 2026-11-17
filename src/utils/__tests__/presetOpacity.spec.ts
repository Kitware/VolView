import { describe, expect, it } from 'vitest';
import '@/src/vtk/ColorMaps';
import { getPresetByName } from '@/src/types/color-map-preset';
import { getShiftedOpacityFromPreset } from '@/src/utils/vtk-helpers';
import { samplePiecewiseLinear } from '@/src/vtk/PiecewiseWidget';

const points = (
  preset: string,
  mappingRange: [number, number],
  fitRange?: [number, number]
) =>
  getShiftedOpacityFromPreset({
    preset,
    mappingRange,
    shift: 0,
    shiftAlpha: 0,
    fitRange,
  })!;

const toScalars = (normalized: number[][], [low, high]: [number, number]) =>
  normalized.map(([x]) => low + x * (high - low));

describe('preset opacity points', () => {
  it('keeps absolute presets in scalar units whatever the editor range', () => {
    const narrow = toScalars(points('CT-AAA', [-1024, 3071]), [-1024, 3071]);
    const wide = toScalars(
      points('CT-AAA', [-3024, 3071], [0, 1]),
      [-3024, 3071]
    );
    expect(narrow.map((x) => x.toFixed(6))).toEqual(
      wide.map((x) => x.toFixed(6))
    );
    expect(narrow[1]).toBeCloseTo(143.556);
  });

  it('maps a relative ramp onto the fit range inside the editor range', () => {
    expect(points('Grayscale', [0, 1000], [100, 200])).toEqual([
      [0.1, 0],
      [0.2, 1],
    ]);
  });

  it("maps an MR preset's effective range onto the fit range", () => {
    const scalars = toScalars(
      points('MR-Angio', [0, 1000], [100, 500]),
      [0, 1000]
    );
    expect(scalars[1]).toBeCloseTo(100);
    expect(scalars[4]).toBeCloseTo(500);
  });

  it('clips MR colors to the effective range', () => {
    const rgb = getPresetByName('MR-Default')!.RGBPoints!;
    const xs = rgb.filter((_, index) => index % 4 === 0);
    expect(xs[0]).toBe(0);
    expect(xs.at(-1)).toBe(1);
    expect(xs.every((x) => x >= 0 && x <= 1)).toBe(true);
  });
});

describe('samplePiecewiseLinear', () => {
  it('holds the end values beyond the end points', () => {
    const samples = samplePiecewiseLinear(
      [
        [0.25, 0.2],
        [0.5, 1],
      ],
      0,
      0,
      5
    );
    expect(samples).toEqual([0.2, 0.2, 1, 1, 1]);
  });
});
