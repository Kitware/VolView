import { describe, expect, it } from 'vitest';
import { frameByteLength, indexFrames } from '../frameIndex';
import {
  EXPLICIT_BE,
  EXPLICIT_LE,
  IMPLICIT_LE,
} from '@/tests/nativePixelDicom';
import { pixelInstance, withNumber, withPhotometric } from './pixelFixture';

const words = Array.from({ length: 3 * 2 * 4 }, (_, index) => index * 257);

const wordsIn = (bytes: Uint8Array, littleEndian: boolean) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  return Array.from({ length: bytes.length / 2 }, (_, index) =>
    view.getUint16(index * 2, littleEndian)
  );
};

describe('frameByteLength', () => {
  it.each([
    ['16 bit grayscale', 1, 16, 'MONOCHROME2', 24],
    ['32 bit grayscale', 1, 32, 'MONOCHROME2', 48],
    ['8 bit RGB', 3, 8, 'RGB', 36],
    ['YBR_FULL', 3, 8, 'YBR_FULL', 36],
    ['YBR_FULL_422, at two bytes a pixel', 3, 8, 'YBR_FULL_422', 24],
  ])(
    'sizes a frame of %s',
    (
      _name,
      samplesPerPixel,
      bitsAllocated,
      photometricInterpretation,
      length
    ) => {
      expect(
        frameByteLength({
          rows: 3,
          columns: 4,
          samplesPerPixel,
          bitsAllocated,
          photometricInterpretation,
        })
      ).toBe(length);
    }
  );
});

describe('indexFrames', () => {
  it.each([
    ['Explicit VR Little Endian', EXPLICIT_LE, 12, true],
    ['Implicit VR Little Endian', IMPLICIT_LE, 8, true],
    ['Explicit VR Big Endian', EXPLICIT_BE, 12, false],
  ])(
    'locates every frame of %s Pixel Data',
    async (_name, transferSyntaxUid, headLength, littleEndian) => {
      const { bytes, instance } = await pixelInstance({
        transferSyntaxUid,
        rows: 2,
        columns: 3,
        frames: 4,
        words,
      });

      const index = indexFrames(instance);

      if (index.kind !== 'indexed') throw new Error(index.detail);
      expect(instance.pixelData!.valueOffset).toBe(
        instance.pixelData!.offset + headLength
      );
      expect(index.littleEndian).toBe(littleEndian);
      expect(index.frameLength).toBe(12);
      expect(index.frames).toHaveLength(4);
      const read = index.frames.flatMap(({ start, end }) =>
        wordsIn(bytes.subarray(start, end), littleEndian)
      );
      expect(read).toEqual(words);
    }
  );

  it.each([
    [
      'at two bytes a pixel where pixel pairs share chroma',
      { samplesPerPixel: 3, photometric: 'YBR_FULL_422' },
      8,
    ],
    [
      'at three bytes a pixel where the file holds that many',
      { samplesPerPixel: 3, photometric: 'YBR_FULL' },
      12,
    ],
    [
      'at one byte a pixel where it has one sample',
      { samplesPerPixel: 1, photometric: 'MONOCHROME2' },
      4,
    ],
  ])(
    'indexes uncompressed frames labeled YBR_FULL_422 %s',
    async (_name, written, frameLength) => {
      const { instance } = await pixelInstance({
        rows: 2,
        columns: 2,
        frames: 2,
        bitsAllocated: 8,
        ...written,
      });
      const start = instance.pixelData!.valueOffset;

      expect(
        indexFrames(withPhotometric(instance, 'YBR_FULL_422'))
      ).toMatchObject({
        kind: 'indexed',
        frameLength,
        frames: [
          { start, end: start + frameLength },
          { start: start + frameLength, end: start + frameLength * 2 },
        ],
      });
      expect(instance.pixelData!.length).toBe(frameLength * 2);
    }
  );

  it.each([
    [
      'encapsulated',
      { transferSyntaxUid: '1.2.840.10008.1.2.4.50' },
      /not indexable without a codec/,
    ],
    [
      'truncated',
      { extra: [{ tag: 0x00280008, vr: 'IS', value: '9' }] },
      /Pixel Data holds 30 bytes; its frames need 270/,
    ],
    [
      'YBR_FULL_420',
      { samplesPerPixel: 3, bitsAllocated: 8, photometric: 'YBR_FULL_420' },
      /YBR_FULL_420 frames have no supported sample layout/,
    ],
    [
      'YBR_PARTIAL_422',
      { samplesPerPixel: 3, bitsAllocated: 8, photometric: 'YBR_PARTIAL_422' },
      /YBR_PARTIAL_422 frames have no supported sample layout/,
    ],
    [
      'misshapen',
      { rows: 0 },
      /Rows, Columns or Samples per Pixel is unusable/,
    ],
  ] as const)(
    'reports %s Pixel Data as unindexed',
    async (_name, options, detail) => {
      const { instance } = await pixelInstance(options);
      expect(indexFrames(instance)).toEqual({
        kind: 'unindexed',
        detail: expect.stringMatching(detail),
      });
    }
  );

  it('reports samples packed across bytes as unindexed', async () => {
    const { instance } = await pixelInstance();
    expect(indexFrames(withNumber(instance, '00280100', 1))).toEqual({
      kind: 'unindexed',
      detail: 'Bits Allocated 1 packs samples across bytes',
    });
  });

  it('reports an instance without Pixel Data as unindexed', () => {
    expect(
      indexFrames({
        source: { read: () => new ReadableStream() },
        dataset: { elements: [], specificCharacterSet: null },
        layout: null,
        transferSyntaxUid: EXPLICIT_LE,
        pixelData: null,
      })
    ).toEqual({
      kind: 'unindexed',
      detail: 'The header locates no Pixel Data',
    });
  });
});
