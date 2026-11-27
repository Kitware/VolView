import { describe, expect, it } from 'vitest';
import {
  decodeNativeFrame,
  decodeNativeFrames,
  type NativePixelFormat,
} from '../nativeFrame';
import type { Palette } from '../palette';

const mono = (overrides: Partial<NativePixelFormat>): NativePixelFormat => ({
  rows: 1,
  columns: 4,
  samplesPerPixel: 1,
  photometricInterpretation: 'MONOCHROME2',
  planar: false,
  bitsAllocated: 16,
  bitsStored: 16,
  signed: false,
  littleEndian: true,
  rescaleSlope: 1,
  rescaleIntercept: 0,
  ...overrides,
});

const littleEndian16 = (words: number[]) =>
  new Uint8Array(new Uint16Array(words).buffer);

describe('decodeNativeFrame', () => {
  it('masks bits above Bits Stored and sign-extends from the top stored bit', () => {
    const format = mono({ bitsStored: 12, signed: true });
    const bytes = littleEndian16([0xf7ff, 0x0800, 0x1fff, 0xa001]);

    const { samples, range } = decodeNativeFrame(bytes, format, Int16Array);

    expect(Array.from(samples)).toEqual([2047, -2048, -1, 1]);
    expect(range).toEqual([[-2048, 2047]]);
  });

  it('reads unsigned and 32 bit words whole', () => {
    const unsigned = decodeNativeFrame(
      littleEndian16([0xf123, 0, 1, 0xffff]),
      mono({ bitsStored: 12 }),
      Uint16Array
    );
    const words32 = new Uint8Array(new Uint32Array([0xffffffff, 7]).buffer);
    const signed32 = decodeNativeFrame(
      words32,
      mono({ columns: 2, bitsAllocated: 32, bitsStored: 32, signed: true }),
      Int32Array
    );
    const unsigned32 = decodeNativeFrame(
      words32,
      mono({ columns: 2, bitsAllocated: 32, bitsStored: 32 }),
      Uint32Array
    );

    expect(Array.from(unsigned.samples)).toEqual([0x123, 0, 1, 0xfff]);
    expect(Array.from(signed32.samples)).toEqual([-1, 7]);
    expect(Array.from(unsigned32.samples)).toEqual([4294967295, 7]);
  });

  it('reads big endian words, from any byte offset', () => {
    const file = new Uint8Array([
      0xff, 0x01, 0x02, 0x80, 0x00, 0, 0, 0xff, 0xff,
    ]);

    const { samples } = decodeNativeFrame(
      file.subarray(1),
      mono({ littleEndian: false, signed: true }),
      Int16Array
    );

    expect(Array.from(samples)).toEqual([0x0102, -32768, 0, -1]);
  });

  it('interleaves planar color and ranges each component', () => {
    const planes = new Uint8Array([1, 2, 30, 40, 250, 200]);

    const { samples, range, components } = decodeNativeFrame(
      planes,
      mono({
        columns: 2,
        samplesPerPixel: 3,
        photometricInterpretation: 'RGB',
        planar: true,
        bitsAllocated: 8,
        bitsStored: 8,
      }),
      Uint8Array
    );

    expect(components).toBe(3);
    expect(Array.from(samples)).toEqual([1, 30, 250, 2, 40, 200]);
    expect(range).toEqual([
      [1, 2],
      [30, 40],
      [200, 250],
    ]);
  });

  it('applies the modality rescale and ranges values before storing them', () => {
    const bytes = littleEndian16([3, 0, 1, 600]);

    const fractional = decodeNativeFrame(
      bytes,
      mono({ rescaleSlope: 0.5, rescaleIntercept: -0.25 }),
      Float64Array
    );
    const narrow = decodeNativeFrame(bytes, mono({}), Uint8Array);

    expect(Array.from(fractional.samples)).toEqual([1.25, -0.25, 0.25, 299.75]);
    expect(narrow.range).toEqual([[0, 600]]);
  });

  it('rounds a fractional rescale into a Float32 volume', () => {
    const format = mono({ rescaleSlope: 0.1, rescaleIntercept: 0.3 });

    const { samples, range } = decodeNativeFrame(
      littleEndian16([3, 0, 1, 600]),
      format,
      Float32Array
    );

    const exact = [3, 0, 1, 600].map((stored) => stored * 0.1 + 0.3);
    expect(Array.from(samples)).toEqual(exact.map(Math.fround));
    expect(range).toEqual([[Math.min(...exact), Math.max(...exact)]]);
  });

  it.each([
    [
      'an unsigned 8 bit word',
      { bitsAllocated: 8, bitsStored: 6 },
      [0xff, 0x41],
      [0x3f, 0x01],
    ],
    [
      'a signed 8 bit word, sign extending from the top stored bit',
      { bitsAllocated: 8, bitsStored: 7, signed: true },
      [0x7f, 0xc0],
      [-1, -64],
    ],
    [
      'a 32 bit word',
      { bitsAllocated: 32, bitsStored: 24 },
      [0x56, 0x34, 0x12, 0xff, 7, 0, 0, 0xff],
      [0x123456, 7],
    ],
  ])('masks %s to Bits Stored', (_name, format, stored, samples) => {
    const decoded = decodeNativeFrame(
      Uint8Array.from(stored),
      mono({ columns: 2, ...format }),
      Float64Array
    );

    expect(Array.from(decoded.samples)).toEqual(samples);
  });

  it.each([
    ['in order', false, [1, 2, 3, 4]],
    ['swapped within each 16 bit word', true, [2, 1, 4, 3]],
  ])('reads 8 bit samples %s', (_name, swappedPairs, samples) => {
    const decoded = decodeNativeFrame(
      Uint8Array.from([1, 2, 3, 4]),
      mono({ bitsAllocated: 8, bitsStored: 8, swappedPairs }),
      Uint8Array
    );

    expect(Array.from(decoded.samples)).toEqual(samples);
  });

  it.each([
    ['interleaved YBR_FULL', 'YBR_FULL', false, [128, 128, 128, 76, 85, 255]],
    ['planar YBR_FULL', 'YBR_FULL', true, [128, 76, 128, 85, 128, 255]],
  ])(
    'converts %s color to RGB, ignoring any rescale',
    (_name, photometricInterpretation, planar, stored) => {
      const { samples, range, components } = decodeNativeFrame(
        Uint8Array.from(stored),
        mono({
          columns: 2,
          samplesPerPixel: 3,
          photometricInterpretation,
          planar,
          bitsAllocated: 8,
          bitsStored: 8,
          rescaleSlope: 2,
          rescaleIntercept: 100,
        }),
        Uint8Array
      );

      expect(Array.from(samples)).toEqual([128, 128, 128, 254, 0, 0]);
      expect(range).toEqual([
        [128, 254],
        [0, 128],
        [0, 128],
      ]);
      expect(components).toBe(3);
    }
  );

  it.each([
    ['in file order', false, [128, 76, 85, 255], [255, 52, 52, 254, 0, 0]],
    [
      'with its byte pairs put back in order first',
      true,
      [150, 100, 128, 128],
      [100, 100, 100, 150, 150, 150],
    ],
  ])(
    'converts YBR_FULL_422 color, whose pixel pairs share chroma, to RGB %s',
    (_name, swappedPairs, stored, rgb) => {
      const { samples } = decodeNativeFrame(
        Uint8Array.from(stored),
        mono({
          columns: 2,
          samplesPerPixel: 3,
          photometricInterpretation: 'YBR_FULL_422',
          bitsAllocated: 8,
          bitsStored: 8,
          swappedPairs,
        }),
        Uint8Array
      );

      expect(Array.from(samples)).toEqual(rgb);
    }
  );

  const paletteFrom = (firstMapped: number, bits: 8 | 16, scale = 1) => ({
    photometricInterpretation: 'PALETTE COLOR',
    palette: {
      firstMapped,
      bits,
      tables: [10, 11, 12].map((first) =>
        Uint16Array.from([0, 10, 20, 30], (step) => (first + step) * scale)
      ) as unknown as Palette['tables'],
    },
  });

  it.each([
    [
      'unsigned 8 bit values, clamped to the table',
      { bitsAllocated: 8, bitsStored: 8, ...paletteFrom(1, 8) },
      [0, 1, 4, 0xff],
      [10, 11, 12, 10, 11, 12, 40, 41, 42, 40, 41, 42],
    ],
    [
      'signed 8 bit values from a negative first mapped',
      { bitsAllocated: 8, bitsStored: 8, signed: true, ...paletteFrom(-2, 8) },
      [0xfe, 0xff, 0, 1],
      [10, 11, 12, 20, 21, 22, 30, 31, 32, 40, 41, 42],
    ],
    [
      'signed 16 bit values from a negative first mapped',
      { signed: true, ...paletteFrom(-2, 8) },
      [0xfe, 0xff, 0xff, 0xff, 0, 0, 1, 0],
      [10, 11, 12, 20, 21, 22, 30, 31, 32, 40, 41, 42],
    ],
    [
      'unsigned values masked to Bits Stored',
      { bitsStored: 12, ...paletteFrom(4, 8) },
      Array.from(littleEndian16([0x1005, 0x1004, 0xf006, 0x0007])),
      [20, 21, 22, 10, 11, 12, 30, 31, 32, 40, 41, 42],
    ],
    [
      'signed values sign extended from Bits Stored',
      { bitsStored: 12, signed: true, ...paletteFrom(-6, 8) },
      Array.from(littleEndian16([0x0ffb, 0x0ffa, 0xfffc, 0x0ffd])),
      [20, 21, 22, 10, 11, 12, 30, 31, 32, 40, 41, 42],
    ],
    [
      '16 bit values to 16 bit color',
      paletteFrom(0, 16, 1000),
      [3, 0, 0, 0, 1, 0, 2, 0],
      [
        40000, 41000, 42000, 10000, 11000, 12000, 20000, 21000, 22000, 30000,
        31000, 32000,
      ],
    ],
  ])('looks up %s in the palette', (_name, format, stored, rgb) => {
    const { samples, components } = decodeNativeFrame(
      Uint8Array.from(stored),
      mono(format),
      Uint16Array
    );

    expect(Array.from(samples)).toEqual(rgb);
    expect(components).toBe(3);
  });

  it('maps grayscale through its Modality LUT in place of the rescale', () => {
    const { samples, range } = decodeNativeFrame(
      littleEndian16([0xffff, 0, 1, 0x8000]),
      mono({
        signed: true,
        rescaleSlope: 2,
        rescaleIntercept: 5,
        modalityLut: {
          firstMapped: -1,
          bits: 16,
          values: Uint16Array.of(100, 200, 300),
        },
      }),
      Uint16Array
    );

    expect(Array.from(samples)).toEqual([100, 200, 300, 100]);
    expect(range).toEqual([[100, 300]]);
  });

  it('rejects a frame shorter than its format', () => {
    expect(() =>
      decodeNativeFrame(new Uint8Array(6), mono({}), Uint16Array)
    ).toThrow('A frame needs 8 bytes of Pixel Data; 6 were read');
  });
});

describe('decodeNativeFrames', () => {
  it('unpacks 1 bit frames that meet inside a byte', () => {
    const format = mono({ columns: 5, bitsAllocated: 1, bitsStored: 1 });

    const pixels = decodeNativeFrames(
      // Lowest bit first: 1 0 0 1 1, then 0 1 1 | 0 1.
      Uint8Array.from([0b11011001, 0b10]),
      [format, format],
      Uint8Array
    );

    expect(Array.from(pixels.data)).toEqual([1, 0, 0, 1, 1, 0, 1, 1, 0, 1]);
    expect(pixels).toMatchObject({
      size: [5, 1, 2],
      components: 1,
      range: [[0, 1]],
    });
  });

  it.each([
    ['unsigned', false, [0xabc, 0x123, 0xfff]],
    ['signed', true, [0xabc - 0x1000, 0x123, -1]],
  ])(
    'unpacks %s 12 bit samples packed end to end',
    (_name, signed, samples) => {
      const format = mono({
        columns: 3,
        bitsAllocated: 12,
        bitsStored: 12,
        signed,
      });

      const pixels = decodeNativeFrames(
        Uint8Array.from([0xbc, 0x3a, 0x12, 0xff, 0x0f]),
        [format],
        Int16Array
      );

      expect(Array.from(pixels.data)).toEqual(samples);
    }
  );

  it('rejects packed Pixel Data too short for its frames', () => {
    const format = mono({ columns: 5, bitsAllocated: 1, bitsStored: 1 });

    expect(() =>
      decodeNativeFrames(new Uint8Array(1), [format, format], Uint8Array)
    ).toThrow('Pixel Data holds 8 bits; its frames need 10');
  });

  it('rescales each frame by its own format and ranges them together', () => {
    const pixels = decodeNativeFrames(
      littleEndian16([1, 2, 3, 4]),
      [
        mono({ columns: 2 }),
        mono({ columns: 2, rescaleSlope: 2, rescaleIntercept: 10 }),
      ],
      Int16Array
    );

    expect(Array.from(pixels.data)).toEqual([1, 2, 16, 18]);
    expect(pixels.range).toEqual([[1, 18]]);
  });
});
