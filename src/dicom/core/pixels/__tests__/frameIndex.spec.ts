import { describe, expect, it } from 'vitest';
import { indexFrames } from '../frameIndex';
import {
  EXPLICIT_BE,
  EXPLICIT_LE,
  IMPLICIT_LE,
} from '@/tests/nativePixelDicom';
import { pixelInstance, withNumber } from './pixelFixture';

const words = Array.from({ length: 3 * 2 * 4 }, (_, index) => index * 257);

const wordsIn = (bytes: Uint8Array, littleEndian: boolean) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  return Array.from({ length: bytes.length / 2 }, (_, index) =>
    view.getUint16(index * 2, littleEndian)
  );
};

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
