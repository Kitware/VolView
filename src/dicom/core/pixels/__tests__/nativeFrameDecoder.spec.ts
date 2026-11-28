import { describe, expect, it } from 'vitest';
import { nativeCapability, nativeFrameDecoder } from '../nativeFrame';
import type { Instance } from '../../instance/readInstance';
import {
  EXPLICIT_BE,
  IMPLICIT_LE,
  type DataElement,
  type NativePixelOptions,
} from '@/tests/nativePixelDicom';
import {
  instanceOf,
  modalityLutElement,
  paletteElements,
  pixelInstance,
  withNumber,
  withPhotometric,
  wordBytes,
} from './pixelFixture';

const element = (
  tag: number,
  vr: string,
  value: DataElement['value']
): DataElement => ({ tag, vr, value });

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
        sopClassUid: '1.2.840.10008.5.1.4.1.1.2.1',
        frames: 2,
        frameRescales: [
          [2, 1],
          [2, 1],
        ],
      },
    ],
    [
      'a differing per-frame rescale',
      {
        sopClassUid: '1.2.840.10008.5.1.4.1.1.2.1',
        frames: 2,
        frameRescales: [
          [1, 0],
          [2, 0],
        ],
      },
    ],
    ['Pixel Padding Value', { extra: [element(0x00280120, 'US', [0])] }],
    ['MONOCHROME1, keeping stored values', { photometric: 'MONOCHROME1' }],
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
      'partially sampled YBR color',
      { samplesPerPixel: 3, bitsAllocated: 8, photometric: 'YBR_PARTIAL_422' },
      /YBR_PARTIAL_422 photometric interpretation with 3 samples/,
    ],
    [
      'four samples per pixel',
      { samplesPerPixel: 4, bitsAllocated: 8, photometric: 'ARGB' },
      /ARGB photometric interpretation with 4 samples/,
    ],
    [
      '16 bit YBR color',
      { samplesPerPixel: 3, photometric: 'YBR_FULL' },
      /YBR_FULL samples of 16 bits/,
    ],
    ['Bits Stored past Bits Allocated', { bitsStored: 20 }, /Bits Stored 20/],
    [
      'palette color with no palette',
      { bitsAllocated: 8, photometric: 'PALETTE COLOR' },
      /No usable Palette Color Lookup Table Descriptor/,
    ],
    [
      'palette color with a table missing',
      {
        bitsAllocated: 8,
        photometric: 'PALETTE COLOR',
        extra: paletteElements([2, 0, 8], [Uint8Array.of(1, 2)]),
      },
      /Palette Color Lookup Table Data is missing/,
    ],
  ] as const)('declines %s', async (_name, options, reason) => {
    const { instance } = await pixelInstance(options);
    expect(nativeCapability(instance, true)).toEqual({
      kind: 'declined',
      reason: expect.stringMatching(reason),
    });
  });

  it.each([24, 64])('declines Bits Allocated %i', async (bitsAllocated) => {
    const { instance } = await pixelInstance();
    expect(
      nativeCapability(withNumber(instance, '00280100', bitsAllocated), true)
    ).toEqual({ kind: 'declined', reason: `Bits Allocated ${bitsAllocated}` });
  });
});

/** What each unit the native decoder plans for `instance` decodes. */
function decodeUnits(instance: Instance, bytes: Uint8Array) {
  const units = nativeFrameDecoder.plan(instance, Float64Array);
  if ('declined' in units) throw new Error(units.declined);
  return Promise.all(
    units.map(async (unit) => ({
      unit,
      pixels: await unit.decode(
        bytes.subarray(unit.range!.start, unit.range!.end),
        new AbortController().signal
      ),
    }))
  );
}

const PAIR = { rows: 1, columns: 2 };

describe('nativeFrameDecoder', () => {
  it('rescales each frame by its own Pixel Value Transformation', async () => {
    const { bytes, instance } = await pixelInstance({
      sopClassUid: '1.2.840.10008.5.1.4.1.1.2.1',
      rows: 1,
      columns: 2,
      frames: 2,
      words: [1, 2, 3, 4],
      frameRescales: [
        [1, 0],
        [2, 10],
      ],
    });

    const frames = (await decodeUnits(instance, bytes)).map(
      ({ pixels }) => pixels
    );

    expect(frames.map(({ data }) => Array.from(data))).toEqual([
      [1, 2],
      [16, 18],
    ]);
    expect(frames.map(({ range }) => range)).toEqual([[[1, 2]], [[16, 18]]]);
  });

  it.each<[string, NativePixelOptions, number[]]>([
    [
      'YBR_FULL color as RGB',
      {
        samplesPerPixel: 3,
        bitsAllocated: 8,
        photometric: 'YBR_FULL',
        words: [128, 128, 128, 76, 85, 255],
      },
      [128, 128, 128, 254, 0, 0],
    ],
    [
      'YBR_FULL_422 color as RGB',
      {
        samplesPerPixel: 3,
        bitsAllocated: 8,
        photometric: 'YBR_FULL_422',
        words: [128, 76, 85, 255],
      },
      [255, 52, 52, 254, 0, 0],
    ],
    [
      'palette color as the RGB its tables hold',
      {
        bitsAllocated: 8,
        photometric: 'PALETTE COLOR',
        words: [0, 9],
        extra: paletteElements(
          [2, 0, 8],
          [Uint8Array.of(10, 20), Uint8Array.of(11, 21), Uint8Array.of(12, 22)]
        ),
      },
      [10, 11, 12, 20, 21, 22],
    ],
    [
      'signed palette values whose Implicit VR descriptor reads unsigned',
      {
        transferSyntaxUid: IMPLICIT_LE,
        bitsAllocated: 8,
        pixelRepresentation: 1,
        photometric: 'PALETTE COLOR',
        words: [0xfe, 1],
        extra: paletteElements(
          [4, 0xfffe, 8],
          [10, 11, 12].map((first) =>
            Uint8Array.of(first, first + 10, first + 20, first + 30)
          )
        ),
      },
      [10, 11, 12, 40, 41, 42],
    ],
    [
      'palette color whose 8 bit entries are held in 16 bit words',
      {
        bitsAllocated: 8,
        photometric: 'PALETTE COLOR',
        words: [0, 1],
        extra: paletteElements(
          [2, 0, 8],
          [0, 1, 2].map(() => wordBytes([0x00ab, 0x00cd]))
        ),
      },
      [171, 171, 171, 205, 205, 205],
    ],
    [
      '8 bit words masked to Bits Stored',
      { bitsAllocated: 8, bitsStored: 6, words: [0xff, 0x41] },
      [0x3f, 0x01],
    ],
    [
      '32 bit words masked to Bits Stored',
      { bitsAllocated: 32, bitsStored: 24, words: [0xff123456, 7] },
      [0x123456, 7],
    ],
    [
      '16 bit words masked to Bits Stored, whatever High Bit says',
      { bitsStored: 12, highBit: 14, words: [0xf123, 0x7fff] },
      [0x123, 0xfff],
    ],
    [
      'big endian 8 bit bytes in file order',
      { transferSyntaxUid: EXPLICIT_BE, bitsAllocated: 8, words: [1, 2] },
      [1, 2],
    ],
    [
      'big endian 32 bit words',
      {
        transferSyntaxUid: EXPLICIT_BE,
        bitsAllocated: 32,
        words: [0x01020304, 7],
      },
      [0x01020304, 7],
    ],
    [
      '16 bit RGB',
      { columns: 1, samplesPerPixel: 3, words: [1000, 2000, 60000] },
      [1000, 2000, 60000],
    ],
    [
      'RGB as stored, whatever rescale it declares',
      {
        columns: 1,
        samplesPerPixel: 3,
        bitsAllocated: 8,
        rescale: [2, 10],
        words: [1, 2, 3],
      },
      [1, 2, 3],
    ],
    [
      'pixels beside overlay planes',
      { words: [5, 6], extra: [element(0x60000100, 'US', [1])] },
      [5, 6],
    ],
    [
      'stored values beside a Modality LUT Sequence of no items',
      { words: [5, 6], extra: [element(0x00283000, 'SQ', [])] },
      [5, 6],
    ],
    [
      'pixels beside an ICC profile',
      {
        words: [5, 6],
        extra: [element(0x00282000, 'OB', Uint8Array.of(1, 2))],
      },
      [5, 6],
    ],
    [
      'grayscale beside a palette descriptor',
      { words: [5, 6], extra: [element(0x00281101, 'US', [256, 0, 16])] },
      [5, 6],
    ],
    [
      'a misspelt photometric interpretation as grayscale',
      { words: [5, 6], photometric: 'MONOCROME2' },
      [5, 6],
    ],
    [
      'an empty photometric interpretation as grayscale',
      { words: [5, 6], photometric: '' },
      [5, 6],
    ],
  ])('decodes %s', async (_name, options, samples) => {
    const { bytes, instance } = await pixelInstance({ ...PAIR, ...options });

    const [{ pixels }] = await decodeUnits(instance, bytes);

    expect(Array.from(pixels.data)).toEqual(samples);
    expect(pixels.components).toBe(samples.length / (options.columns ?? 2));
  });

  const XA = '1.2.840.10008.5.1.4.1.1.12.1';
  const RF = '1.2.840.10008.5.1.4.1.1.12.2';
  const BIPLANE = '1.2.840.10008.5.1.4.1.1.12.3';
  const TABLE = [1000, 2000, 3000];
  const lut = modalityLutElement([3, 10, 16], wordBytes(TABLE));

  it.each<[string, NativePixelOptions, number[]]>([
    [
      'maps grayscale through a table of little endian words',
      { extra: [lut] },
      [1000, 1000, 2000, 3000],
    ],
    [
      'maps grayscale through a table of big endian words',
      {
        transferSyntaxUid: EXPLICIT_BE,
        extra: [modalityLutElement([3, 10, 16], wordBytes(TABLE, false))],
      },
      [1000, 1000, 2000, 3000],
    ],
    [
      'maps grayscale through a table held as numbers',
      { extra: [modalityLutElement([3, 10, 16], TABLE)] },
      [1000, 1000, 2000, 3000],
    ],
    [
      'maps grayscale through a table of one byte an entry',
      { extra: [modalityLutElement([3, 10, 8], Uint8Array.of(100, 150, 200))] },
      [100, 100, 150, 200],
    ],
    [
      'maps through the table in place of the rescale',
      { rescale: [2, 5], extra: [lut] },
      [1000, 1000, 2000, 3000],
    ],
    [
      'leaves X-Ray Angiographic values as stored',
      { sopClassUid: XA, extra: [lut] },
      [9, 10, 11, 500],
    ],
    [
      'leaves X-Ray Radiofluoroscopic values as stored',
      { sopClassUid: RF, extra: [lut] },
      [9, 10, 11, 500],
    ],
    [
      'leaves retired biplane X-Ray values as stored',
      { sopClassUid: BIPLANE, extra: [lut] },
      [9, 10, 11, 500],
    ],
    [
      'rescales as usual where the item has no LUT Descriptor',
      {
        rescale: [2, 5],
        extra: [modalityLutElement(undefined, wordBytes(TABLE))],
      },
      [23, 25, 27, 1005],
    ],
    [
      'rescales as usual where the item has no LUT Data',
      { rescale: [2, 5], extra: [modalityLutElement([3, 10, 16], undefined)] },
      [23, 25, 27, 1005],
    ],
    [
      'reads a first mapped value past 0x7fff as negative for signed pixels',
      {
        transferSyntaxUid: IMPLICIT_LE,
        pixelRepresentation: 1,
        words: [0xffff, 0, 1, 2],
        extra: [
          modalityLutElement([3, 0xffff, 16], wordBytes([100, 200, 300])),
        ],
      },
      [100, 200, 300, 300],
    ],
    [
      'leaves color as stored',
      {
        columns: 1,
        samplesPerPixel: 3,
        bitsAllocated: 8,
        words: [9, 10, 11],
        extra: [lut],
      },
      [9, 10, 11],
    ],
  ])('%s, given a Modality LUT', async (_name, options, samples) => {
    const { bytes, instance } = await pixelInstance({
      rows: 1,
      columns: 4,
      words: [9, 10, 11, 500],
      ...options,
    });

    const [{ pixels }] = await decodeUnits(instance, bytes);

    expect(Array.from(pixels.data)).toEqual(samples);
  });

  it.each([
    [
      'OB bytes in file order',
      'OB',
      4,
      [
        [1, 2, 3, 4],
        [5, 6, 7, 8],
      ],
    ],
    [
      'OW bytes swapped back out of their words',
      'OW',
      4,
      [
        [2, 1, 4, 3],
        [6, 5, 8, 7],
      ],
    ],
    [
      'OB bytes of odd frames in file order',
      'OB',
      3,
      [
        [1, 2, 3],
        [4, 5, 6],
      ],
    ],
    [
      'OW words that straddle odd frames, in one unit',
      'OW',
      3,
      [[2, 1, 4, 3, 6, 5]],
    ],
  ])('reads big endian 8 bit %s', async (_name, vr, columns, units) => {
    const file = await pixelInstance({
      transferSyntaxUid: EXPLICIT_BE,
      bitsAllocated: 8,
      rows: 1,
      columns,
      frames: 2,
      words: Array.from({ length: columns * 2 }, (_, index) => index + 1),
    });
    const bytes = file.bytes.slice();
    bytes.set(
      new TextEncoder().encode(vr),
      file.instance.pixelData!.offset + 4
    );

    const decoded = await decodeUnits(await instanceOf(bytes), bytes);

    expect(decoded.map(({ pixels }) => Array.from(pixels.data))).toEqual(units);
    expect(decoded.map(({ pixels }) => pixels.size)).toEqual(
      units.map((unit) => [columns, 1, unit.length / columns])
    );
  });

  it.each([
    [
      'three bytes a pixel as fully sampled color',
      { samplesPerPixel: 3, words: [128, 128, 128, 76, 85, 255] },
      [128, 128, 128, 254, 0, 0],
    ],
    ['one sample a pixel as grayscale', { words: [5, 6] }, [5, 6]],
  ])(
    'decodes a file labeled YBR_FULL_422 that holds %s',
    async (_name, options, samples) => {
      const { bytes, instance } = await pixelInstance({
        ...PAIR,
        bitsAllocated: 8,
        ...options,
      });

      const [{ pixels }] = await decodeUnits(
        withPhotometric(instance, 'YBR_FULL_422'),
        bytes
      );

      expect(Array.from(pixels.data)).toEqual(samples);
    }
  );

  /** A file of 8 bit pixels whose header is altered to call them packed. */
  const packedInstance = async (
    options: NativePixelOptions,
    header: Record<string, number>
  ) => {
    const { bytes, instance } = await pixelInstance({
      bitsAllocated: 8,
      rows: 1,
      columns: 1,
      ...options,
    });
    return {
      bytes,
      instance: Object.entries(header).reduce(
        (packed, [tag, value]) => withNumber(packed, tag, value),
        instance
      ),
    };
  };
  const ONE_BIT = { '00280100': 1, '00280101': 1, '00280011': 5 };

  it('reads every frame of packed 1 bit samples as one unit', async () => {
    const { bytes, instance } = await packedInstance(
      { frames: 2, words: [0b11011001, 0b10] },
      ONE_BIT
    );
    const { valueOffset } = instance.pixelData!;

    const [{ unit, pixels }, ...rest] = await decodeUnits(instance, bytes);

    expect(rest).toEqual([]);
    expect(unit).toMatchObject({
      firstFrame: 0,
      frames: 2,
      range: { start: valueOffset, end: valueOffset + 2 },
    });
    expect(Array.from(pixels.data)).toEqual([1, 0, 0, 1, 1, 0, 1, 1, 0, 1]);
    expect(pixels.size).toEqual([5, 1, 2]);
  });

  it.each([
    ['OB', [1, 0, 0, 1, 1, 0, 1, 1, 0, 1]],
    // The two bytes are one 16 bit word, stored most significant byte first.
    ['OW', [0, 1, 0, 0, 0, 0, 0, 0, 1, 0]],
  ])('unpacks big endian 1 bit samples held as %s', async (vr, samples) => {
    const { bytes, instance } = await packedInstance(
      { transferSyntaxUid: EXPLICIT_BE, frames: 2, words: [0b11011001, 0b10] },
      ONE_BIT
    );
    const held = { ...instance, pixelData: { ...instance.pixelData!, vr } };

    const [{ pixels }] = await decodeUnits(held, bytes);

    expect(Array.from(pixels.data)).toEqual(samples);
  });
});
