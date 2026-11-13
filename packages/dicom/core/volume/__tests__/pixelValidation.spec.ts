import { describe, expect, it } from 'vitest';
import { assertSamplesRepresentable } from '../pixelValidation';

const intoFloat32 =
  (min: number, max: number, rescaleSlope: number, rescaleIntercept = 0) =>
  () =>
    assertSamplesRepresentable(
      new Float64Array([min, max]),
      { min, max },
      new Float32Array(1),
      { where: 'File 1.2.3', rescales: [{ rescaleSlope, rescaleIntercept }] }
    );

describe('assertSamplesRepresentable into a Float32 volume', () => {
  it('accepts integers float32 holds exactly', () => {
    expect(intoFloat32(-(2 ** 24), 2 ** 24, 1, -1024)).not.toThrow();
  });

  it('rejects integers float32 would round', () => {
    expect(intoFloat32(0, 2 ** 24 + 1, 1)).toThrow(/Float32Array/);
  });

  it('accepts fractional values whose stored steps float32 keeps apart', () => {
    expect(intoFloat32(-0.25, 4095 * 0.5 - 0.25, 0.5, -0.25)).not.toThrow();
  });

  it('rejects fractional values float32 would merge with their neighbours', () => {
    expect(intoFloat32(0, 2 ** 23, 0.5, 0.25)).toThrow(/rescale slope of 0.5/);
  });

  it('judges every frame calibration of an instance', () => {
    expect(() =>
      assertSamplesRepresentable(
        new Float64Array([0, 2 ** 22]),
        { min: 0, max: 2 ** 22 },
        new Float32Array(1),
        {
          where: 'File 1.2.3',
          rescales: [
            { rescaleSlope: 1, rescaleIntercept: 0 },
            { rescaleSlope: 0.25, rescaleIntercept: 0.5 },
          ],
        }
      )
    ).toThrow(/rescale slope of 0.25/);
  });
});
