import { describe, expect, it } from 'vitest';
import { reframeMaskScalars } from '@/src/segmentation/masks/storage';
import type { Extent3D } from '@/src/segmentation/model';

describe('reframing into a reusable mask buffer', () => {
  it('overwrites old labels and padding when the source moves or is erased', () => {
    const to: Extent3D = [4, 6, 5, 7, 6, 8];
    const output = new Uint8Array(27).fill(9);
    const source = new Uint8Array([1]);
    expect(reframeMaskScalars(source, [5, 5, 6, 6, 7, 7], to, output)).toBe(
      output
    );
    expect([...output]).toEqual(
      Array.from({ length: 27 }, (_, i) => (i === 13 ? 1 : 0))
    );
    reframeMaskScalars(source, [6, 6, 7, 7, 8, 8], to, output);
    expect([...output]).toEqual(
      Array.from({ length: 27 }, (_, i) => (i === 26 ? 1 : 0))
    );
    source[0] = 0;
    reframeMaskScalars(source, [6, 6, 7, 7, 8, 8], to, output);
    expect([...output]).toEqual(Array(27).fill(0));
  });

  it('clips source rows at the destination and clears disjoint copies', () => {
    const from: Extent3D = [2, 5, 3, 4, 4, 4];
    const to: Extent3D = [3, 4, 4, 5, 4, 4];
    const source = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const output = new Uint8Array(4).fill(9);
    reframeMaskScalars(source, from, to, output);
    expect([...output]).toEqual([6, 7, 0, 0]);
    expect([...source]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    reframeMaskScalars(source, from, [3, 4, 9, 10, 4, 4], output);
    expect([...output]).toEqual([0, 0, 0, 0]);
  });

  it('rejects a destination buffer of the wrong size before changing it', () => {
    const output = new Uint8Array([9]);
    expect(() =>
      reframeMaskScalars([1], [0, 0, 0, 0, 0, 0], [0, 1, 0, 0, 0, 0], output)
    ).toThrow('Mask output size mismatch');
    expect([...output]).toEqual([9]);
  });
});
