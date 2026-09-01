import type { Chunk } from '@/src/core/streaming/chunk';
import { Tags } from '@/src/core/dicomTags';
import {
  allocateImageFromChunks,
  getPixelFormat,
  getRescaledValueRange,
  getBufferValueRange,
  getTypedArrayForDataRange,
  getTypedArrayValueRange,
  getVolumeBufferType,
  samplesAreIntegral,
  valuesFitBuffer,
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

// Builds a format from exactly the tags given, with no defaults filled in, so
// each test states the whole instance it is describing.
function format(tags: Record<string, string>) {
  return getPixelFormat(Object.entries(tags));
}

const UNSIGNED_16 = format({
  [Tags.BitsStored]: '16',
  [Tags.PixelRepresentation]: '0',
});
const SIGNED_16 = format({
  [Tags.BitsStored]: '16',
  [Tags.PixelRepresentation]: '1',
});
const UNSIGNED_8 = format({
  [Tags.BitsStored]: '8',
  [Tags.PixelRepresentation]: '0',
});
// A CT stored as 12-bit unsigned and rescaled to Hounsfield units.
const RESCALED_CT = format({
  [Tags.BitsStored]: '12',
  [Tags.PixelRepresentation]: '0',
  [Tags.RescaleSlope]: '1',
  [Tags.RescaleIntercept]: '-1024',
});
const NEGATIVE_SLOPE_8 = format({
  [Tags.BitsStored]: '8',
  [Tags.PixelRepresentation]: '0',
  [Tags.RescaleSlope]: '-1',
});
const PUBLIC_DSC_SLOPE = '112067.85375182';
const PUBLIC_DSC = format({
  [Tags.BitsStored]: '16',
  [Tags.PixelRepresentation]: '0',
  [Tags.RescaleSlope]: PUBLIC_DSC_SLOPE,
  [Tags.RescaleIntercept]: '0',
});

describe('getPixelFormat', () => {
  it('uses the DICOM defaults for absent rescale tags', () => {
    expect(UNSIGNED_16).toEqual({
      bitsStored: 16,
      pixelRepresentation: 0,
      rescaleSlope: 1,
      rescaleIntercept: 0,
    });
  });

  it('reports bitsStored 0 when the tag is absent', () => {
    expect(format({ [Tags.PixelRepresentation]: '0' }).bitsStored).toBe(0);
  });

  it('treats a zero-length element as absent rather than as zero', () => {
    expect(
      format({ [Tags.BitsStored]: '16', [Tags.RescaleSlope]: '' }).rescaleSlope
    ).toBe(1);
    expect(
      format({ [Tags.BitsStored]: '16', [Tags.RescaleSlope]: '  ' })
        .rescaleSlope
    ).toBe(1);
    expect(
      format({ [Tags.BitsStored]: '', [Tags.PixelRepresentation]: '' })
    ).toEqual({
      bitsStored: 0,
      pixelRepresentation: 0,
      rescaleSlope: 1,
      rescaleIntercept: 0,
    });
  });

  it('parses padded numeric strings', () => {
    expect(
      format({ [Tags.BitsStored]: '16', [Tags.RescaleIntercept]: ' -1024 ' })
        .rescaleIntercept
    ).toBe(-1024);
  });
});

describe('getRescaledValueRange', () => {
  it('spans the stored range put through slope and intercept', () => {
    expect(getRescaledValueRange(UNSIGNED_16)).toEqual({ min: 0, max: 65535 });
    expect(getRescaledValueRange(SIGNED_16)).toEqual({
      min: -32768,
      max: 32767,
    });
    expect(getRescaledValueRange(RESCALED_CT)).toEqual({
      min: -1024,
      max: 3071,
    });
  });

  it('orders the endpoints when the slope is negative', () => {
    expect(getRescaledValueRange(NEGATIVE_SLOPE_8)).toEqual({
      min: -255,
      max: 0,
    });
  });

  it('is null when BitsStored is missing', () => {
    expect(getRescaledValueRange(format({}))).toBeNull();
  });
});

describe('getVolumeBufferType', () => {
  it('widens to hold the rescaled range', () => {
    expect(getVolumeBufferType([UNSIGNED_8])).toBe(Uint8Array);
    expect(getVolumeBufferType([UNSIGNED_16])).toBe(Uint16Array);
    expect(getVolumeBufferType([SIGNED_16])).toBe(Int16Array);
    expect(getVolumeBufferType([RESCALED_CT])).toBe(Int16Array);
    expect(getVolumeBufferType([NEGATIVE_SLOPE_8])).toBe(Int16Array);
    expect(
      getVolumeBufferType([
        format({ [Tags.BitsStored]: '16', [Tags.RescaleIntercept]: '-1024' }),
      ])
    ).toBe(Int32Array);
  });

  it('throws when BitsStored is missing', () => {
    expect(() => getVolumeBufferType([format({})])).toThrow();
  });

  it('matches the Float64 output observed in the public DSC perfusion series', () => {
    expect(getVolumeBufferType([PUBLIC_DSC])).toBe(Float64Array);
  });

  it('uses Float64 when fractional rescale has integral endpoints', () => {
    expect(
      getVolumeBufferType([
        format({
          [Tags.BitsStored]: '12',
          [Tags.RescaleSlope]: '0.2',
          [Tags.RescaleIntercept]: '0',
        }),
      ])
    ).toBe(Float64Array);
  });

  it('uses Float64 when an integral modality range exceeds 32 bits', () => {
    expect(
      getVolumeBufferType([
        format({
          [Tags.BitsStored]: '16',
          [Tags.RescaleSlope]: '112068',
          [Tags.RescaleIntercept]: '0',
        }),
      ])
    ).toBe(Float64Array);
  });

  it('rejects a non-finite modality range', () => {
    expect(() =>
      getVolumeBufferType([
        format({
          [Tags.BitsStored]: '16',
          [Tags.PixelRepresentation]: '0',
          [Tags.RescaleSlope]: '1e308',
        }),
      ])
    ).toThrow('No instance declares a finite modality rescale range');
  });

  it('leaves an instance with no usable range out of the union', () => {
    // The containment guard rejects such an instance when it decodes; its
    // faulty tags must not stop the rest of the series from allocating.
    expect(getVolumeBufferType([format({}), UNSIGNED_16])).toBe(Uint16Array);
    expect(
      getVolumeBufferType([
        UNSIGNED_16,
        format({ [Tags.BitsStored]: '16', [Tags.RescaleSlope]: '1e308' }),
      ])
    ).toBe(Uint16Array);
  });

  it('chooses one type that represents every instance in the volume', () => {
    expect(getVolumeBufferType([UNSIGNED_8, UNSIGNED_16])).toBe(Uint16Array);
    expect(getVolumeBufferType([UNSIGNED_16, PUBLIC_DSC])).toBe(Float64Array);
  });
});

describe('getTypedArrayValueRange', () => {
  it('reports what each element type holds', () => {
    expect(getTypedArrayValueRange(Uint8Array)).toEqual({ min: 0, max: 255 });
    expect(getTypedArrayValueRange(Int16Array)).toEqual({
      min: -32768,
      max: 32767,
    });
  });

  it('has no range to report for element types the allocator never makes', () => {
    expect(getTypedArrayValueRange(Float32Array)).toBeUndefined();
  });
});

describe('getBufferValueRange', () => {
  it('reads the range off the buffer itself', () => {
    expect(getBufferValueRange(new Uint16Array(4))).toEqual({
      min: 0,
      max: 65535,
    });
    expect(getBufferValueRange(new Int32Array(4))).toEqual({
      min: -(2 ** 31),
      max: 2 ** 31 - 1,
    });
  });
});

describe('valuesFitBuffer', () => {
  it('accepts a range inside the buffer type', () => {
    expect(valuesFitBuffer({ min: 0, max: 255 }, new Uint16Array(1))).toBe(
      true
    );
    expect(valuesFitBuffer({ min: -1024, max: 3071 }, new Int16Array(1))).toBe(
      true
    );
  });

  it('accepts the exact bounds of the buffer type', () => {
    expect(valuesFitBuffer({ min: 0, max: 65535 }, new Uint16Array(1))).toBe(
      true
    );
    expect(
      valuesFitBuffer({ min: -32768, max: 32767 }, new Int16Array(1))
    ).toBe(true);
  });

  it('rejects negative values in an unsigned buffer', () => {
    expect(
      valuesFitBuffer({ min: -2048, max: -2048 }, new Uint16Array(1))
    ).toBe(false);
  });

  it('rejects values wider than the buffer type', () => {
    expect(valuesFitBuffer({ min: 0, max: 5000 }, new Uint8Array(1))).toBe(
      false
    );
    expect(valuesFitBuffer({ min: 0, max: 65536 }, new Uint16Array(1))).toBe(
      false
    );
  });

  it('accepts a slice whose declared range would overflow but whose values do not', () => {
    // A slice declaring BitsStored 16 could reach 65535, which an Int16Array
    // volume cannot hold, but what it actually decoded to fits.
    const declaredRange = getRescaledValueRange(UNSIGNED_16)!;
    expect(valuesFitBuffer(declaredRange, new Int16Array(1))).toBe(false);
    expect(valuesFitBuffer({ min: 2000, max: 2000 }, new Int16Array(1))).toBe(
      true
    );
  });

  it('judges the range only, leaving fractions to samplesAreIntegral', () => {
    expect(valuesFitBuffer({ min: 0.5, max: 100.5 }, new Uint16Array(1))).toBe(
      true
    );
  });

  it('constrains nothing when the buffer has no integer range', () => {
    expect(
      valuesFitBuffer({ min: -1e30, max: 1e30 }, new Float64Array(1))
    ).toBe(true);
  });
});

describe('samplesAreIntegral', () => {
  it('trusts integer typed arrays without scanning them', () => {
    expect(
      samplesAreIntegral(new Uint16Array([1, 5000]), new Uint8Array(1))
    ).toBe(true);
  });

  it('rejects fractional float samples bound for an integer buffer', () => {
    expect(
      samplesAreIntegral(new Float64Array([0, 0.5, 1]), new Uint16Array(1))
    ).toBe(false);
    expect(samplesAreIntegral([1, 1.5], new Int16Array(1))).toBe(false);
  });

  it('accepts float samples that are whole numbers', () => {
    expect(
      samplesAreIntegral(new Float64Array([0, 1, 2]), new Uint16Array(1))
    ).toBe(true);
    expect(
      samplesAreIntegral(new Float32Array([-3, 4]), new Int16Array(1))
    ).toBe(true);
  });

  it('accepts anything bound for a float buffer', () => {
    expect(
      samplesAreIntegral(new Float64Array([0.5, 1e30]), new Float64Array(1))
    ).toBe(true);
  });
});

describe('allocateImageFromChunks', () => {
  it('allocates for the modality range of every chunk', () => {
    const image = allocateImageFromChunks([
      positionedChunk(0),
      positionedChunk(1, {
        [Tags.BitsStored]: '16',
        [Tags.PixelRepresentation]: '0',
        [Tags.RescaleSlope]: PUBLIC_DSC_SLOPE,
        [Tags.RescaleIntercept]: '0',
      }),
    ]);
    const data = image.getPointData().getScalars().getData();

    expect(data).toBeInstanceOf(Float64Array);
    expect(data).toHaveLength(3 * 4 * 2);
  });

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
