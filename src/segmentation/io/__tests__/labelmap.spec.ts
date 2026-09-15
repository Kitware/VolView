import { describe, expect, it } from 'vitest';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import {
  allocateLabelmap,
  labelmapScalars,
  normalizeLabelmapScalars,
} from '../labelmap';

describe('labelmap interchange storage', () => {
  it.each([255, 256, 65535])('stores label %i without truncation', (count) => {
    const parent = vtkImageData.newInstance({
      spacing: [2, 3, 4],
      origin: [5, 6, 7],
    });
    parent.setDimensions(2, 2, 2);
    const image = allocateLabelmap(parent, count);
    const values = labelmapScalars(image);
    values[7] = count;
    expect(values[7]).toBe(count);
    expect(values.BYTES_PER_ELEMENT).toBe(count <= 255 ? 1 : 2);
    expect(image.indexToWorld([1, 1, 1])).toEqual(
      parent.indexToWorld([1, 1, 1])
    );
  });

  it('rejects a single-file export beyond 16-bit capacity', () => {
    expect(() => allocateLabelmap(vtkImageData.newInstance(), 65536)).toThrow(
      'at most 65535'
    );
  });

  it('keeps high input values and excludes invalid values without wrapping', () => {
    const input = new Float32Array([
      0,
      1,
      255,
      256,
      65535,
      -1,
      65536,
      NaN,
      Infinity,
    ]);
    const values = normalizeLabelmapScalars(input);
    expect(values).toBeInstanceOf(Uint16Array);
    expect(Array.from(values)).toEqual([0, 1, 255, 256, 65535, 0, 0, 0, 0]);
    expect(input[6]).toBe(65536);
  });

  it('normalizes a wide binary input to byte mask storage', () => {
    expect(normalizeLabelmapScalars(new Uint16Array([0, 1]))).toEqual(
      new Uint8Array([0, 1])
    );
  });
});
