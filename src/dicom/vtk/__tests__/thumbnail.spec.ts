import { describe, expect, it } from 'vitest';
import { sliceToThumbnail } from '../thumbnail';

const bytes = (slice: { data: Uint8Array }) => Array.from(slice.data);

describe('sliceToThumbnail', () => {
  it('casts a slice onto the full 8 bit range of its window', () => {
    const slice = sliceToThumbnail({
      data: [0, 10, 20, 30, 40, 50, 60, 70],
      width: 4,
      height: 2,
      components: 1,
      range: [0, 70],
    });

    expect(slice.width).toBe(4);
    expect(slice.height).toBe(2);
    expect(slice.data).toBeInstanceOf(Uint8Array);
    expect(bytes(slice)).toEqual([0, 36, 73, 109, 146, 182, 219, 255]);
  });

  it('clamps samples outside the window', () => {
    const slice = sliceToThumbnail({
      data: [0, 10, 15, 20, 30],
      width: 5,
      height: 1,
      components: 1,
      range: [10, 20],
    });

    expect(bytes(slice)).toEqual([0, 0, 128, 255, 255]);
  });

  it('reads an empty window as a blank slice instead of dividing by zero', () => {
    const slice = sliceToThumbnail({
      data: [1, 5, 9],
      width: 3,
      height: 1,
      components: 1,
      range: [5, 5],
    });

    expect(bytes(slice)).toEqual([0, 0, 0]);
  });

  it('reads a sample that is not a finite number as blank', () => {
    const slice = sliceToThumbnail({
      data: [NaN, Infinity, -Infinity, 1],
      width: 4,
      height: 1,
      components: 1,
      range: [0, 1],
    });

    expect(bytes(slice)).toEqual([0, 0, 0, 255]);
  });

  it('downsamples both axes by one stride to at most 256 on the longer side', () => {
    const width = 512;
    const slice = sliceToThumbnail({
      data: Uint16Array.from({ length: width * 2 }, (_, index) => index),
      width,
      height: 2,
      components: 1,
      range: [0, 255],
    });

    expect(slice.width).toBe(256);
    expect(slice.height).toBe(1);
    // Every second sample of the first row, the corners of the 2x2 blocks.
    expect(bytes(slice).slice(0, 4)).toEqual([0, 2, 4, 6]);
  });

  it('samples RGB luminance for color slices', () => {
    const slice = sliceToThumbnail({
      data: [255, 0, 0, 0, 255, 0, 0, 0, 255],
      width: 3,
      height: 1,
      components: 3,
      range: [0, 255],
    });

    expect(bytes(slice)).toEqual([76, 150, 29]);
  });
});
