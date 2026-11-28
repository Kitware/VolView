import { describe, expect, it } from 'vitest';
import {
  expandSegmentedTable,
  paletteAsRgb,
  readPalette,
  type Palette,
} from '../palette';
import {
  paletteElements,
  pixelInstance,
  SEGMENTED_PALETTE_DATA,
  wordBytes,
} from './pixelFixture';
import {
  EXPLICIT_LE,
  IMPLICIT_LE,
  type DataElement,
  type NativePixelOptions,
} from '@/tests/nativePixelDicom';

const tables = (...channels: number[][]) =>
  channels.map((channel) => Uint16Array.from(channel)) as [
    Uint16Array,
    Uint16Array,
    Uint16Array,
  ];

describe('paletteAsRgb', () => {
  const palette: Palette = {
    firstMapped: 10,
    bits: 8,
    tables: tables([1, 2, 3], [11, 12, 13], [21, 22, 23]),
  };

  it.each([
    ['the first mapped value', 10, [1, 11, 21]],
    ['a value inside the table', 11, [2, 12, 22]],
    ['the last entry', 12, [3, 13, 23]],
    ['a value below the first mapped', 9, [1, 11, 21]],
    ['a negative value', -5, [1, 11, 21]],
    ['a value past the table', 500, [3, 13, 23]],
  ])('looks up %s', (_name, value, rgb) => {
    expect(Array.from(paletteAsRgb([value], palette))).toEqual(rgb);
  });

  it('interleaves the color of each value in turn', () => {
    expect(Array.from(paletteAsRgb([12, 10], palette))).toEqual([
      3, 13, 23, 1, 11, 21,
    ]);
  });

  it('keeps 16 bit entries whole', () => {
    const wide = paletteAsRgb([0], {
      firstMapped: 0,
      bits: 16,
      tables: tables([0x1234], [0xffff], [0x0100]),
    });

    expect(wide).toEqual(Uint16Array.from([0x1234, 0xffff, 0x0100]));
  });
});

describe('expandSegmentedTable', () => {
  it.each([
    ['a discrete run', [0, 3, 7, 8, 9], [7, 8, 9]],
    ['a linear ramp from the last value', [0, 1, 20, 1, 2, 40], [20, 30, 40]],
    [
      'a ramp whose halves round to even',
      [0, 1, 0, 1, 2, 5, 1, 2, 8],
      [0, 2, 5, 6, 8],
    ],
    ['a falling ramp', [0, 1, 40, 1, 4, 0], [40, 30, 20, 10, 0]],
    [
      'an indirect segment repeating the two before it',
      [0, 2, 10, 20, 1, 2, 40, 2, 2, 0, 0],
      [10, 20, 30, 40, 10, 20, 30, 40],
    ],
    [
      'an indirect segment repeating one from an offset',
      [0, 1, 5, 0, 2, 6, 7, 2, 1, 3, 0],
      [5, 6, 7, 6, 7],
    ],
    ['a trailing pad word', [0, 1, 7, 0], [7]],
  ])('expands %s', (_name, data, expanded) => {
    expect(expandSegmentedTable(data)).toEqual(expanded);
  });

  it.each([
    ['a linear segment with nothing before it', [1, 2, 40], /starts with/],
    ['an undefined opcode', [0, 1, 7, 3, 1, 0], /opcode 3 is not defined/],
  ])('rejects %s', (_name, data, message) => {
    expect(() => expandSegmentedTable(data)).toThrow(message);
  });
});

const readFrom = async (
  extra: DataElement[],
  options: NativePixelOptions = {}
) => {
  const { instance } = await pixelInstance({
    bitsAllocated: 8,
    photometric: 'PALETTE COLOR',
    ...options,
    extra,
  });
  return readPalette(instance.dataset, true);
};

const sameInEachChannel = (words: number[]) => [words, words, words];

describe('readPalette', () => {
  it.each([8, 16])(
    'reads entries held one to a byte as they are under a %i bit descriptor',
    async (entryBits) => {
      const bytes = [
        [10, 20, 30, 40],
        [11, 21, 31, 41],
        [12, 22, 32, 42],
      ];

      expect(
        await readFrom(
          paletteElements(
            [4, 0, entryBits],
            bytes.map((channel) => Uint8Array.from(channel))
          )
        )
      ).toEqual({ firstMapped: 0, bits: 8, tables: tables(...bytes) });
    }
  );

  it.each([
    [8, 8, [0x12, 0xab], [0x56, 0xef], [0x9a, 0x01]],
    [16, 16, [0x1234, 0xabcd], [0x5678, 0xef01], [0x9abc, 0x0123]],
  ])(
    'reads 16 bit entries for %i bit pixels as %i bit color',
    async (bitsAllocated, bits, ...channels) => {
      const words = [
        [0x1234, 0xabcd],
        [0x5678, 0xef01],
        [0x9abc, 0x0123],
      ];

      expect(
        await readFrom(
          paletteElements(
            [2, 5, 16],
            words.map((channel) => wordBytes(channel))
          ),
          { bitsAllocated }
        )
      ).toEqual({ firstMapped: 5, bits, tables: tables(...channels) });
    }
  );

  it.each([
    ['8 bit entries an 8 bit descriptor holds in words', 8, [0xab, 0xcd]],
    ['the high byte once a 16 bit descriptor says so', 16, [0, 0]],
  ])('gives 8 bit pixels %s', async (_name, entryBits, entries) => {
    const palette = await readFrom(
      paletteElements(
        [2, 0, entryBits],
        sameInEachChannel([0x00ab, 0x00cd]).map((channel) => wordBytes(channel))
      )
    );

    expect(palette).toMatchObject({
      bits: 8,
      tables: tables(...sameInEachChannel(entries)),
    });
  });

  it.each([8, 16])(
    'gives %i bit pixels the high byte once an entry of an 8 bit descriptor passes 255',
    async (bitsAllocated) => {
      const palette = await readFrom(
        paletteElements(
          [2, 0, 8],
          [
            [0x12ab, 0x00cd],
            [1, 2],
            [3, 4],
          ].map((channel) => wordBytes(channel))
        ),
        { bitsAllocated }
      );

      expect(palette).toMatchObject({
        bits: 8,
        tables: tables([0x12, 0], [0, 0], [0, 0]),
      });
    }
  );

  it.each([
    ['as negative for signed pixels in Implicit VR', IMPLICIT_LE, 1, -2],
    ['as negative for signed pixels in Explicit VR', EXPLICIT_LE, 1, -2],
    ['as it is for unsigned pixels', IMPLICIT_LE, 0, 0xfffe],
  ])(
    'reads a first mapped value past 0x7fff %s',
    async (_name, transferSyntaxUid, pixelRepresentation, firstMapped) => {
      const palette = await readFrom(
        paletteElements(
          [4, 0xfffe, 8],
          sameInEachChannel([10, 20, 30, 40]).map((channel) =>
            Uint8Array.from(channel)
          )
        ),
        { transferSyntaxUid, pixelRepresentation }
      );

      expect(palette).toMatchObject({ firstMapped });
    }
  );

  it('expands segmented tables', async () => {
    const segments = [
      [0, 1, 0x0100, 1, 3, 0x0400],
      [0, 4, 1, 2, 3, 4],
      [0, 2, 9, 8, 2, 1, 0, 0],
    ];

    expect(
      await readFrom(
        paletteElements(
          [4, 0, 16],
          segments.map((channel) => wordBytes(channel)),
          SEGMENTED_PALETTE_DATA
        ),
        { bitsAllocated: 16 }
      )
    ).toEqual({
      firstMapped: 0,
      bits: 16,
      tables: tables(
        [0x0100, 0x0200, 0x0300, 0x0400],
        [1, 2, 3, 4],
        [9, 8, 9, 8]
      ),
    });
  });

  it.each([
    ['no descriptor', [], /No usable Palette Color Lookup Table Descriptor/],
    [
      'only two of its tables',
      paletteElements([4, 0, 8], [new Uint8Array(4), new Uint8Array(4)]),
      /Palette Color Lookup Table Data is missing/,
    ],
  ])('reports a palette with %s as missing', async (_name, extra, missing) => {
    expect(await readFrom(extra)).toEqual({
      missing: expect.stringMatching(missing),
    });
  });
});
