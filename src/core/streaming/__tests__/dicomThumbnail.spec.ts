import { describe, expect, it } from 'vitest';
import {
  sliceToThumbnail,
  THUMBNAIL_MAX_SIZE,
} from '@/src/core/streaming/dicomThumbnail';

const bytes = (slice: { data: Uint8Array }) => Array.from(slice.data);

describe('sliceToThumbnail', () => {
  it('casts a slice onto the full 8 bit range of its window', () => {
    const slice = sliceToThumbnail({
      data: [0, 10, 20, 30, 40, 50, 60, 70],
      width: 4,
      height: 2,
      range: [0, 70],
      maxSize: 4,
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
      range: [10, 20],
      maxSize: 8,
    });

    expect(bytes(slice)).toEqual([0, 0, 128, 255, 255]);
  });

  it('reads an empty window as a blank slice instead of dividing by zero', () => {
    const slice = sliceToThumbnail({
      data: [1, 5, 9],
      width: 3,
      height: 1,
      range: [5, 5],
      maxSize: 8,
    });

    expect(bytes(slice)).toEqual([0, 0, 0]);
  });

  it('reads a sample that is not a finite number as blank', () => {
    const slice = sliceToThumbnail({
      data: [NaN, Infinity, -Infinity, 1],
      width: 4,
      height: 1,
      range: [0, 1],
      maxSize: 8,
    });

    expect(bytes(slice)).toEqual([0, 0, 0, 255]);
  });

  it('downsamples both axes by one stride', () => {
    const slice = sliceToThumbnail({
      data: [0, 10, 20, 30, 40, 50, 60, 70],
      width: 4,
      height: 2,
      range: [0, 70],
      maxSize: 2,
    });

    expect(slice.width).toBe(2);
    expect(slice.height).toBe(1);
    // The samples at (0,0) and (2,0), the corners of the 2x2 source blocks.
    expect(bytes(slice)).toEqual([0, 73]);
  });

  it('keeps every sample of a slice that already fits', () => {
    const slice = sliceToThumbnail({
      data: [0, 1, 2, 3],
      width: 2,
      height: 2,
      range: [0, 3],
    });

    expect(slice.width).toBe(2);
    expect(slice.height).toBe(2);
    expect(slice.data).toHaveLength(4);
  });

  it('bounds a large slice by the default maximum size', () => {
    const width = THUMBNAIL_MAX_SIZE * 2;
    const slice = sliceToThumbnail({
      data: new Uint16Array(width).fill(1),
      width,
      height: 1,
      range: [0, 1],
    });

    expect(slice.width).toBe(THUMBNAIL_MAX_SIZE);
    expect(slice.height).toBe(1);
    expect(slice.data).toHaveLength(THUMBNAIL_MAX_SIZE);
  });

  it('reads the first component of a multi sample slice', () => {
    const slice = sliceToThumbnail({
      data: [0, 9, 9, 10, 9, 9, 30, 9, 9],
      width: 3,
      height: 1,
      components: 3,
      range: [0, 30],
      maxSize: 8,
    });

    expect(bytes(slice)).toEqual([0, 85, 255]);
  });

  it('does not mutate the samples it reads', () => {
    const data = [0, 10, 20, 30];
    sliceToThumbnail({ data, width: 4, height: 1, range: [0, 30] });
    expect(data).toEqual([0, 10, 20, 30]);
  });
});
