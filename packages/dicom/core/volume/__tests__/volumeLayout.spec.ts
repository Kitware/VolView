import { datasetFromTags } from '@/tests/dicomDataset';
import { describe, it, expect } from 'vitest';
import {
  readGeometryFacts,
  sliceNormalOf,
} from '../../collections/instanceFacts';
import { reconstructVolume } from '../../collections/reconstructVolume';
import { Tags } from '../../metadata/dicomTags';
import {
  getPixelFormat,
  getRescaledValueRange,
  getBufferValueRange,
  getTypedArrayForDataRange,
  getTypedArrayValueRange,
  getVolumeBufferType,
  samplesAreIntegral,
  valuesFitBuffer,
} from '../pixelFormat';
import { volumeLayout, type VolumeSource } from '../volumeLayout';

function volumeSource(overrides: Record<string, string> = {}): VolumeSource {
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
  return { dataset: datasetFromTags(Object.entries(metadata)) };
}

function positionedSource(z: number, overrides: Record<string, string> = {}) {
  return volumeSource({
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
    expect(getVolumeBufferType([UNSIGNED_16, PUBLIC_DSC])).toBe(Float32Array);
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

describe('volumeLayout', () => {
  it.each([
    ['0.0104\\0', [1, 0.0104, 1]],
    ['0.0104\\NaN', [1, 0.0104, 1]],
    ['0.0104', [0.0104, 0.0104, 1]],
    ['0.5', [0.5, 0.5, 1]],
    ['0', [1, 1, 1]],
    ['-0.5', [1, 1, 1]],
    ['NaN', [1, 1, 1]],
    ['Infinity', [1, 1, 1]],
    ['0\\0.046875', [0.046875, 1, 1]],
    ['NaN\\0.046875', [0.046875, 1, 1]],
    ['0\\0', [1, 1, 1]],
  ])(
    'preserves valid axes independently for PixelSpacing %s',
    (value, expected) => {
      const image = layoutOf(
        [volumeSource({ [Tags.PixelSpacing]: value as string })],
        [1, 0, 0, 0, 1, 0]
      );
      expect(image.getSpacing()).toEqual(expected);
    }
  );

  it('allocates for the modality range of every member', () => {
    const image = layoutOf(
      [
        positionedSource(0),
        positionedSource(1, {
          [Tags.BitsStored]: '16',
          [Tags.PixelRepresentation]: '0',
          [Tags.RescaleSlope]: PUBLIC_DSC_SLOPE,
          [Tags.RescaleIntercept]: '0',
        }),
      ],
      [1, 0, 0, 0, 1, 0]
    );
    expect(image.bufferType).toBe(Float32Array);
    expect(image.getDimensions()).toEqual([4, 3, 2]);
  });

  it('matches ITK spacing order for single-slice images with SpacingBetweenSlices', () => {
    const image = layoutOf(
      [
        volumeSource({
          [Tags.PixelSpacing]: '2.5\\0.75',
          [Tags.SpacingBetweenSlices]: '7.25',
        }),
      ],
      [1, 0, 0, 0, 1, 0]
    );

    expect(Array.from(image.getSpacing())).toEqual([0.75, 2.5, 7.25]);
  });

  it('uses declared inter-frame spacing for a multi-frame volume', () => {
    const image = layoutOf(
      [
        volumeSource({
          [Tags.NumberOfFrames]: '32',
          [Tags.PixelSpacing]: '0.0104\\0.046875',
          [Tags.SpacingBetweenSlices]: '0.1875',
        }),
      ],
      [1, 0, 0, 0, 1, 0]
    );
    expect(Array.from(image.getDimensions())).toEqual([4, 3, 32]);
    expect(Array.from(image.getSpacing())).toEqual([0.046875, 0.0104, 0.1875]);
  });

  it('takes the multi-slice Z spacing from an even stack of positions', () => {
    const image = layoutOf(
      [
        positionedSource(0, {
          [Tags.PixelSpacing]: '2.5\\0.75',
          [Tags.SpacingBetweenSlices]: '19',
        }),
        positionedSource(9),
        positionedSource(18),
      ],
      [1, 0, 0, 0, 1, 0]
    );

    expect(Array.from(image.getSpacing())).toEqual([0.75, 2.5, 9]);
  });

  // Two 4mm runs with a hole between them, as the bilateral sagittal slabs of
  // idcSeriesFixtures.ts are. Endpoint distance over slice count would call
  // that a 17.33mm lattice, which describes neither run.
  it('does not fit an irregular stack to a lattice its slices never sit on', () => {
    const image = layoutOf(
      [0, 4, 8, 48, 52].map((z) => positionedSource(z)),
      [1, 0, 0, 0, 1, 0]
    );

    expect(image.getSpacing()[2]).toBeCloseTo(4, 12);
  });

  it('orients the image along the validated slice normal', () => {
    const image = layoutOf(
      [volumeSource({ [Tags.ImageOrientationPatient]: '0\\1\\0\\0\\0\\-1' })],
      [0, 1, 0, 0, 0, -1]
    );

    expect(Array.from(image.getDirection())).toEqual([
      0, 1, 0, 0, 0, -1, -1, 0, 0,
    ]);
  });

  it('keeps the identity direction for an orientation that spans no plane', () => {
    const image = layoutOf(
      [volumeSource({ [Tags.ImageOrientationPatient]: '1\\0\\0\\1\\0\\0' })],
      null
    );

    expect(Array.from(image.getDirection())).toEqual([
      1, 0, 0, 0, 1, 0, 0, 0, 1,
    ]);
  });

  it('leaves the Z spacing alone when no position can be read', () => {
    const image = layoutOf(
      [
        volumeSource({ [Tags.ImagePositionPatient]: '' }),
        volumeSource({ [Tags.ImagePositionPatient]: '' }),
      ],
      [1, 0, 0, 0, 1, 0]
    );

    expect(image.getSpacing()[2]).toBe(1);
  });

  it('takes the declared SpacingBetweenSlices when no position can be read', () => {
    const image = layoutOf(
      [
        volumeSource({
          [Tags.ImagePositionPatient]: '',
          [Tags.SpacingBetweenSlices]: '2.5',
        }),
        volumeSource({ [Tags.ImagePositionPatient]: '' }),
      ],
      [1, 0, 0, 0, 1, 0]
    );

    expect(image.getSpacing()[2]).toBe(2.5);
  });

  it('takes the declared SpacingBetweenSlices for a multi-frame instance', () => {
    const image = layoutOf(
      [
        volumeSource({
          [Tags.NumberOfFrames]: '4',
          [Tags.SpacingBetweenSlices]: '1.5',
        }),
      ],
      [1, 0, 0, 0, 1, 0]
    );

    expect(Array.from(image.getDimensions())).toEqual([4, 3, 4]);
    expect(image.getSpacing()[2]).toBe(1.5);
  });

  // A tilted gantry leans every slice plane sideways of the last, so no lattice
  // holds them; the extent the table stepped over is kept all the same.
  it('steps a tilted gantry stack by the distance its slices advance', () => {
    const theta = Math.PI / 9;
    const tilted = [1, 0, 0, 0, Math.cos(theta), Math.sin(theta)];

    const image = layoutOf(
      [0, 3, 6, 9].map((z) =>
        positionedSource(z, {
          [Tags.ImageOrientationPatient]: tilted.join('\\'),
        })
      ),
      tilted
    );

    expect(image.getSpacing()[2]).toBeCloseTo(3, 12);
    expect(image.getDirection()[5]).toBeCloseTo(Math.sin(theta), 12);
  });
});

const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** Plans the members' stack as the collection planner would, then lays it out. */
function layoutOf(sources: VolumeSource[], orientation: number[] | null) {
  const reconstruction = reconstructVolume(
    sources.map((item) => readGeometryFacts(item.dataset)),
    sliceNormalOf(orientation)
  );
  const layout = volumeLayout(sources, orientation, reconstruction);
  return {
    bufferType: layout.bufferType,
    getDimensions: () => [layout.columns, layout.rows, layout.slices],
    getSpacing: () => layout.spatialMetadata.axes.map((axis) => axis.value),
    getDirection: () => layout.direction ?? IDENTITY,
  };
}
