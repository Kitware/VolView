import { describe, expect, it } from 'vitest';
import type { NativePixelOptions } from '@/tests/nativePixelDicom';
import { createGdcmDecoder, type GdcmLane } from '../gdcmDecoder';
import { pixelInstance } from '../../pixels/__tests__/pixelFixture';
import type { DecodeUnit } from '../../pixels/pixelDecoder';

const assets = {
  pipelineWorkerUrl: '/unused-worker.js',
  imageIOUrl: '/unused-image-io',
};

/** A lane that answers every decode with one sample, as GDCM wrote it. */
const answering = (sample: number) => (): GdcmLane => ({
  run: async () => ({
    data: Float64Array.of(sample),
    size: [1, 1, 1],
    components: 1,
  }),
  reset: () => {},
});

async function decodeWith(sample: number, options: NativePixelOptions) {
  const { instance, bytes } = await pixelInstance({
    rows: 1,
    columns: 1,
    ...options,
  });
  const { decoder } = createGdcmDecoder(assets, 1, answering(sample));
  const [unit] = decoder.plan(instance, Float64Array) as DecodeUnit[];
  const pixels = await unit.decode(bytes, new AbortController().signal);
  return Array.from(pixels.data);
}

describe('GDCM decoder', () => {
  // GDCM's outputs here were read from GDCM in a browser for the stored value.
  it.each([
    ['unsigned 12 bit', { bitsStored: 12 }, 3995, 100],
    ['rescaled 12 bit', { bitsStored: 12, rescale: [2, -50] }, 7940, 150],
    ['signed 12 bit', { bitsStored: 12, pixelRepresentation: 1 }, 99, -100],
    [
      'rescaled signed 16 bit',
      { pixelRepresentation: 1, rescale: [1, -1024] },
      -925,
      -1124,
    ],
    ['unsigned 8 bit', { bitsAllocated: 8 }, 245, 10],
  ] as const)(
    'returns the stored values of %s MONOCHROME1 pixels, which GDCM inverts',
    async (_name, options, gdcm, stored) => {
      expect(
        await decodeWith(gdcm, { photometric: 'MONOCHROME1', ...options })
      ).toEqual([stored]);
    }
  );

  it('passes MONOCHROME2 pixels through', async () => {
    expect(await decodeWith(3995, { bitsStored: 12 })).toEqual([3995]);
  });
});
