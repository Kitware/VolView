import { describe, expect, it } from 'vitest';
import {
  decodeNativeFrame,
  nativeCapability,
  type NativePixelFormat,
} from '../nativeFrame';
import { EXPLICIT_BE, type DataElement } from '@/tests/nativePixelDicom';
import { pixelInstance } from './pixelFixture';

const mono = (overrides: Partial<NativePixelFormat>): NativePixelFormat => ({
  rows: 1,
  columns: 4,
  samplesPerPixel: 1,
  photometricInterpretation: 'MONOCHROME2',
  planar: false,
  bitsAllocated: 16,
  bitsStored: 16,
  highBit: 15,
  signed: false,
  littleEndian: true,
  rescaleSlope: 1,
  rescaleIntercept: 0,
  ...overrides,
});

const littleEndian16 = (words: number[]) =>
  new Uint8Array(new Uint16Array(words).buffer);

describe('decodeNativeFrame', () => {
  it('masks bits above Bits Stored and sign-extends from the high bit', () => {
    const format = mono({ bitsStored: 12, highBit: 11, signed: true });
    const bytes = littleEndian16([0xf7ff, 0x0800, 0x1fff, 0xa001]);

    const { samples, range } = decodeNativeFrame(bytes, format, Int16Array);

    expect(Array.from(samples)).toEqual([2047, -2048, -1, 1]);
    expect(range).toEqual([[-2048, 2047]]);
  });

  it('reads unsigned and 32 bit words whole', () => {
    const unsigned = decodeNativeFrame(
      littleEndian16([0xf123, 0, 1, 0xffff]),
      mono({ bitsStored: 12, highBit: 11 }),
      Uint16Array
    );
    const words32 = new Uint8Array(new Uint32Array([0xffffffff, 7]).buffer);
    const signed32 = decodeNativeFrame(
      words32,
      mono({
        columns: 2,
        bitsAllocated: 32,
        bitsStored: 32,
        highBit: 31,
        signed: true,
      }),
      Int32Array
    );
    const unsigned32 = decodeNativeFrame(
      words32,
      mono({ columns: 2, bitsAllocated: 32, bitsStored: 32, highBit: 31 }),
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

  it('interleaves planar colour and ranges each component', () => {
    const planes = new Uint8Array([1, 2, 30, 40, 250, 200]);

    const { samples, range } = decodeNativeFrame(
      planes,
      mono({
        columns: 2,
        samplesPerPixel: 3,
        photometricInterpretation: 'RGB',
        planar: true,
        bitsAllocated: 8,
        bitsStored: 8,
        highBit: 7,
      }),
      Uint8Array
    );

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

  it('rounds a fractional rescale into a Float32 volume as GDCM samples are', () => {
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

  it('rejects a frame shorter than its format', () => {
    expect(() =>
      decodeNativeFrame(new Uint8Array(6), mono({}), Uint16Array)
    ).toThrow('A frame needs 8 bytes of Pixel Data; 6 were read');
  });
});

const element = (tag: number, vr: string, value: string | number[]) =>
  ({ tag, vr, value }) as DataElement;

describe('nativeCapability', () => {
  it.each([
    ['signed 12 bit monochrome', { bitsStored: 12, pixelRepresentation: 1 }],
    [
      '8 bit RGB',
      { samplesPerPixel: 3, bitsAllocated: 8, planarConfiguration: 1 },
    ],
    ['32 bit words', { bitsAllocated: 32 }],
    ['big endian 16 bit words', { transferSyntaxUid: EXPLICIT_BE }],
    [
      'a uniform per-frame rescale',
      {
        frames: 2,
        frameRescales: [
          [2, 1],
          [2, 1],
        ],
      },
    ],
    ['Pixel Padding Value', { extra: [element(0x00280120, 'US', [0])] }],
  ] as const)('decodes %s natively', async (_name, options) => {
    const { instance } = await pixelInstance(options);
    expect(
      nativeCapability(instance, !('transferSyntaxUid' in options))
    ).toMatchObject({
      kind: 'native',
    });
  });

  it.each([
    [
      'MONOCHROME1, which GDCM inverts',
      { photometric: 'MONOCHROME1' },
      /MONOCHROME1/,
    ],
    [
      'YBR colour',
      { samplesPerPixel: 3, bitsAllocated: 8, photometric: 'YBR_FULL' },
      /YBR_FULL/,
    ],
    [
      'palette colour',
      { bitsAllocated: 8, photometric: 'PALETTE COLOR' },
      /PALETTE COLOR/,
    ],
    [
      '8 bit words with unstored bits, which GDCM keeps',
      { bitsAllocated: 8, bitsStored: 6 },
      /6 of 8/,
    ],
    [
      '32 bit words with unstored bits',
      { bitsAllocated: 32, bitsStored: 24 },
      /24 of 32/,
    ],
    ['a shifted high bit', { bitsStored: 12, highBit: 14 }, /High Bit 14/],
    [
      'big endian 8 bit words',
      { transferSyntaxUid: EXPLICIT_BE, bitsAllocated: 8 },
      /Big endian 8/,
    ],
    ['16 bit RGB', { samplesPerPixel: 3 }, /RGB/],
    [
      'rescaled RGB',
      { samplesPerPixel: 3, bitsAllocated: 8, rescale: [2, 0] },
      /RGB/,
    ],
    [
      'differing per-frame rescale',
      {
        frames: 2,
        frameRescales: [
          [1, 0],
          [2, 0],
        ],
      },
      /differing modality rescale/,
    ],
    ['overlay planes', { extra: [element(0x60000100, 'US', [1])] }, /Overlay/],
    [
      'a Modality LUT',
      { extra: [element(0x00283000, 'SQ', [])] },
      /Modality LUT/,
    ],
  ] as const)('declines %s', async (_name, options, reason) => {
    const { instance } = await pixelInstance(options);
    const littleEndian = !('transferSyntaxUid' in options);
    expect(nativeCapability(instance, littleEndian)).toEqual({
      kind: 'declined',
      reason: expect.stringMatching(reason),
    });
  });
});
