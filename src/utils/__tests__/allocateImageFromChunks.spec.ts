import type { Chunk } from '@/src/core/streaming/chunk';
import { Tags } from '@/src/core/dicomTags';
import {
  allocateImageFromChunks,
  getTypedArrayForDataRange,
} from '@/src/utils/allocateImageFromChunks';
import { describe, it, expect } from 'vitest';

function chunk(overrides: Record<string, string> = {}) {
  const metadata = {
    [Tags.SOPInstanceUID]: '1.2.3',
    [Tags.ImagePositionPatient]: '0\\0\\0',
    [Tags.ImageOrientationPatient]: '1\\0\\0\\0\\1\\0',
    [Tags.Rows]: '3',
    [Tags.Columns]: '4',
    [Tags.BitsStored]: '16',
    [Tags.PixelRepresentation]: '0',
    [Tags.SamplesPerPixel]: '1',
    ...overrides,
  };
  return {
    metadata: Object.entries(metadata),
  } as unknown as Chunk;
}

function positionedChunk(z: number, overrides: Record<string, string> = {}) {
  return chunk({
    [Tags.ImagePositionPatient]: `0\\0\\${z}`,
    ...overrides,
  });
}

describe('getTypedArrayForDataRange', () => {
  it('should handle edge cases', () => {
    expect(getTypedArrayForDataRange(-(2 ** 7), 2 ** 7 - 1)).toBe(Int8Array);
    expect(getTypedArrayForDataRange(-(2 ** 15), 2 ** 15 - 1)).toBe(Int16Array);
    expect(getTypedArrayForDataRange(-(2 ** 31), 2 ** 31 - 1)).toBe(Int32Array);
    expect(getTypedArrayForDataRange(0, 2 ** 8 - 1)).toBe(Uint8Array);
    expect(getTypedArrayForDataRange(0, 2 ** 16 - 1)).toBe(Uint16Array);
    expect(getTypedArrayForDataRange(0, 2 ** 32 - 1)).toBe(Uint32Array);
  });
});

describe('allocateImageFromChunks', () => {
  it('matches ITK spacing order for single-slice images with SpacingBetweenSlices', () => {
    const image = allocateImageFromChunks([
      chunk({
        [Tags.PixelSpacing]: '2.5\\0.75',
        [Tags.SpacingBetweenSlices]: '7.25',
      }),
    ]);

    expect(Array.from(image.getSpacing())).toEqual([0.75, 2.5, 7.25]);
  });

  it('keeps deriving multi-slice Z spacing from ImagePositionPatient distance', () => {
    const image = allocateImageFromChunks([
      positionedChunk(0, {
        [Tags.PixelSpacing]: '2.5\\0.75',
        [Tags.SpacingBetweenSlices]: '19',
      }),
      positionedChunk(9),
      positionedChunk(18),
    ]);

    expect(Array.from(image.getSpacing())).toEqual([0.75, 2.5, 9]);
  });
});
