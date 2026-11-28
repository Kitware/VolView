import { datasetFromTags } from '@/tests/dicomDataset';
import { describe, it, expect } from 'vitest';
import { Tags } from '../../metadata/dicomTags';
import {
  getPixelFormat,
  getRescaledValueRange,
  getVolumeBufferType,
  instancePixelFormats,
} from '../pixelFormat';
import { enhanced, groups, sequence } from './enhancedFixture';

// Builds a format from exactly the tags given, with no defaults filled in, so
// each test states the whole instance it is describing.
function format(tags: Record<string, string>) {
  return getPixelFormat(datasetFromTags(Object.entries(tags)));
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
    expect(
      getVolumeBufferType([
        format({ [Tags.BitsStored]: '8', [Tags.PixelRepresentation]: '1' }),
      ])
    ).toBe(Int8Array);
    expect(getVolumeBufferType([RESCALED_CT])).toBe(Int16Array);
    expect(getVolumeBufferType([NEGATIVE_SLOPE_8])).toBe(Int16Array);
    expect(
      getVolumeBufferType([
        format({ [Tags.BitsStored]: '16', [Tags.RescaleIntercept]: '-1024' }),
      ])
    ).toBe(Float32Array);
  });

  it('throws when BitsStored is missing', () => {
    expect(() => getVolumeBufferType([format({})])).toThrow();
  });

  it('keeps the public DSC perfusion series in float32, whose spacing stays below its slope', () => {
    expect(getVolumeBufferType([PUBLIC_DSC])).toBe(Float32Array);
  });

  it('uses Float32 when fractional rescale has integral endpoints', () => {
    expect(
      getVolumeBufferType([
        format({
          [Tags.BitsStored]: '12',
          [Tags.RescaleSlope]: '0.2',
          [Tags.RescaleIntercept]: '0',
        }),
      ])
    ).toBe(Float32Array);
  });

  // 65535 * 256 + 256 is exactly 2^24, the last integer float32 counts to.
  it.each([
    ['256', Float32Array],
    ['257', Uint32Array],
  ])(
    'keeps integers in float32 only up to 2^24 (intercept %s)',
    (intercept, type) => {
      expect(
        getVolumeBufferType([
          format({
            [Tags.BitsStored]: '16',
            [Tags.RescaleSlope]: '256',
            [Tags.RescaleIntercept]: intercept,
          }),
        ])
      ).toBe(type);
    }
  );

  it('keeps signed integers beyond 2^24 in Int32', () => {
    expect(
      getVolumeBufferType([
        format({
          [Tags.BitsStored]: '16',
          [Tags.PixelRepresentation]: '1',
          [Tags.RescaleSlope]: '513',
        }),
      ])
    ).toBe(Int32Array);
  });

  // Values reach 2^23 + 1.5 + slope, so float32's spacing there is just above
  // 1 + 1.788e-7: one slope keeps steps apart and the other merges them.
  it.each([
    ['1.0000002', Float32Array],
    ['1.0000001', Float64Array],
  ])(
    'uses Float32 for fractional slope %s only while steps stay apart',
    (slope, type) => {
      expect(
        getVolumeBufferType([
          format({
            [Tags.BitsStored]: '1',
            [Tags.RescaleSlope]: slope,
            [Tags.RescaleIntercept]: '8388608.5',
          }),
        ])
      ).toBe(type);
    }
  );

  it.each([
    ['24', Float32Array],
    ['25', Float64Array],
  ])(
    'stores at most 24 bits of fractional rescale in Float32 (Bits Stored %s)',
    (bitsStored, type) => {
      expect(
        getVolumeBufferType([
          format({
            [Tags.BitsStored]: bitsStored,
            [Tags.PixelRepresentation]: '1',
            [Tags.RescaleSlope]: '0.5',
            [Tags.RescaleIntercept]: '0.25',
          }),
        ])
      ).toBe(type);
    }
  );

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
    ).toThrow(
      'No instance declares Bits Stored and a finite modality rescale range'
    );
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
    expect(getVolumeBufferType([UNSIGNED_16, PUBLIC_DSC])).toBe(Float32Array);
  });
});

const LUT_DESCRIPTOR = '00283002';
const LUT_DATA = '00283006';
const TABLE_ITEM = { [LUT_DESCRIPTOR]: '4096\\0\\16', [LUT_DATA]: '0' };

describe('instancePixelFormats', () => {
  it.each([
    [
      'holds the 16 bit values of an applied table',
      {},
      TABLE_ITEM,
      Uint16Array,
    ],
    [
      'holds unsigned table values for signed pixels',
      { [Tags.BitsStored]: '12', [Tags.PixelRepresentation]: '1' },
      TABLE_ITEM,
      Uint16Array,
    ],
    [
      'holds stored values for X-Ray Angiographic, which leaves the table unapplied',
      { '00080016': '1.2.840.10008.5.1.4.1.1.12.1' },
      TABLE_ITEM,
      Uint8Array,
    ],
    [
      'holds stored values for color',
      { [Tags.SamplesPerPixel]: '3' },
      TABLE_ITEM,
      Uint8Array,
    ],
    [
      'holds rescaled values where the item has no LUT Descriptor',
      { [Tags.RescaleIntercept]: '-128' },
      { [LUT_DATA]: TABLE_ITEM[LUT_DATA] },
      Int8Array,
    ],
    [
      'holds rescaled values where the item has no LUT Data',
      { [Tags.RescaleIntercept]: '-128' },
      { [LUT_DESCRIPTOR]: TABLE_ITEM[LUT_DESCRIPTOR] },
      Int8Array,
    ],
  ])('given a Modality LUT Sequence, %s', (_name, root, lut, Buffer) => {
    const header = datasetFromTags(
      Object.entries({
        [Tags.BitsStored]: '8',
        [Tags.PixelRepresentation]: '0',
        ...root,
      })
    );
    const item = datasetFromTags(Object.entries(lut));
    const metadata = {
      ...header,
      elements: [...header.elements, sequence('00283000', [item])],
    };

    expect(getVolumeBufferType(instancePixelFormats(metadata))).toBe(Buffer);
  });

  it.each([
    ['color, which has no rescale', '3', Uint8Array],
    ['grayscale, which its rescale makes signed', '1', Int8Array],
  ])('sizes the buffer of 8 bit %s', (_name, samplesPerPixel, Buffer) => {
    const metadata = datasetFromTags([
      [Tags.SamplesPerPixel, samplesPerPixel],
      [Tags.BitsStored, '8'],
      [Tags.PixelRepresentation, '0'],
      [Tags.RescaleIntercept, '-128'],
    ]);

    expect(getVolumeBufferType(instancePixelFormats(metadata))).toBe(Buffer);
  });

  it('reads frames past the per-frame groups from the root, however many are declared', () => {
    const metadata = enhanced(
      groups([]),
      [
        groups([
          sequence('00289145', [
            datasetFromTags([
              ['00281053', '.5'],
              ['00281052', '-500'],
            ]),
          ]),
        ]),
      ],
      { '00280008': String(2 ** 32), '00281052': '1e9' }
    );
    expect(getVolumeBufferType(instancePixelFormats(metadata))).toBe(
      Float64Array
    );
  });
});
