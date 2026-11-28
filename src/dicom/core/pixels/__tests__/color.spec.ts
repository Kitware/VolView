import { describe, expect, it } from 'vitest';
import { planesAsInterleaved, ybr422AsYbrFull, ybrFullAsRgb } from '../color';

describe('ybrFullAsRgb', () => {
  it.each([
    ['black', [0, 128, 128], [0, 0, 0]],
    ['gray', [128, 128, 128], [128, 128, 128]],
    ['white', [255, 128, 128], [255, 255, 255]],
    ['red', [76, 85, 255], [254, 0, 0]],
    ['green', [150, 44, 21], [0, 255, 1]],
    ['blue', [29, 255, 107], [0, 0, 254]],
    ['chroma past white, clamped', [255, 255, 255], [255, 121, 255]],
    ['chroma past black, clamped', [0, 0, 0], [0, 135, 0]],
  ])('converts %s', (_name, ybr, rgb) => {
    expect(Array.from(ybrFullAsRgb(Uint8Array.from(ybr)))).toEqual(rgb);
  });

  it('converts each pixel of a run on its own', () => {
    const ybr = Uint8Array.from([76, 85, 255, 128, 128, 128]);

    expect(Array.from(ybrFullAsRgb(ybr))).toEqual([254, 0, 0, 128, 128, 128]);
  });
});

describe('ybr422AsYbrFull', () => {
  it('gives both pixels of a stored pair the chroma they share', () => {
    const stored = Uint8Array.from([1, 2, 100, 200, 3, 4, 110, 210]);

    expect(Array.from(ybr422AsYbrFull(stored, 4))).toEqual([
      1, 100, 200, 2, 100, 200, 3, 110, 210, 4, 110, 210,
    ]);
  });
});

describe('planesAsInterleaved', () => {
  it('takes one sample from each plane for every pixel', () => {
    const planes = Uint8Array.from([1, 2, 30, 40, 250, 200]);

    expect(Array.from(planesAsInterleaved(planes, 2))).toEqual([
      1, 30, 250, 2, 40, 200,
    ]);
  });
});
