import { describe, expect, it } from 'vitest';
import { prepareScalarPlane, scalarWindow } from '@/src/core/vtk/scalarPlane';

describe('scalar upload precision', () => {
  it('retains distinct floats in a mixed-sign dynamic range', () => {
    const values = Float32Array.from([-1, 0, 1e-8, 1, NaN]);
    const plane = prepareScalarPlane(values);
    expect(Array.from(plane.scalars)).toEqual([-1, 0, values[2], 1, 0]);
    expect(plane.scalars[1]).not.toBe(plane.scalars[2]);
    expect(plane.scalars.buffer).not.toBe(values.buffer);
    expect(values[4]).toBeNaN();
  });

  it.each([
    [1e9, 1e9 + 64, 1e9],
    [-1e9 - 64, -1e9, -1e9],
    [65535, 65535, 65535],
    [0.0001, 0.00015, Math.fround(0.0001)],
  ])(
    'recenters nearby same-sign floats %s to %s without losing bits',
    (min, max, offset) => {
      const values = Float32Array.from([min, max]);
      const plane = prepareScalarPlane(values);
      expect(plane.offset).toBe(offset);
      expect(
        Array.from(plane.scalars, (value) => value + plane.offset)
      ).toEqual(Array.from(values));
      const window = { width: 1e-12, level: values[0] };
      expect(scalarWindow(window, plane.offset).level).toBe(plane.scalars[0]);
    }
  );

  it('retains original floats when recentering could collapse them', () => {
    const values = Float32Array.from([1, 99999992, 1e8]);
    const plane = prepareScalarPlane(values);
    expect(plane.offset).toBe(0);
    expect(Array.from(plane.scalars)).toEqual(Array.from(values));
    expect(scalarWindow({ width: 8, level: 99999996 }, plane.offset)).toEqual({
      width: 8,
      level: 99999996,
    });
  });
});
