import { describe, expect, it } from 'vitest';
import { createHtj2kDecoder, type Htj2kLane } from '../htj2kDecoder';
import { pixelInstance } from '../../pixels/__tests__/pixelFixture';
import type { NativePixelOptions } from '@/tests/nativePixelDicom';

const HTJ2K_LOSSLESS = '1.2.840.10008.1.2.4.201';

// Two by two pixels of three samples, as OpenJPH returns colour.
const RGB = Uint8Array.from([
  10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120,
]);

const rgbLane = (): Htj2kLane => ({
  run: async () => ({
    bytes: RGB.slice(),
    columns: 2,
    rows: 2,
    components: 3,
    bytesPerSample: 1,
  }),
  reset: () => {},
});

async function htj2kInstance(options: NativePixelOptions) {
  const { instance } = await pixelInstance(options);
  return {
    ...instance,
    transferSyntaxUid: HTJ2K_LOSSLESS,
    pixelData: { ...instance.pixelData!, length: null },
  };
}

const colourInstance = (photometric: string) =>
  htj2kInstance({
    rows: 2,
    columns: 2,
    samplesPerPixel: 3,
    bitsAllocated: 8,
    photometric,
  });

describe('HTJ2K decoder', () => {
  it.each(['RGB', 'YBR_RCT', 'YBR_ICT'])(
    'decodes %s colour to the RGB samples OpenJPH returns',
    async (photometric) => {
      const { decoder } = createHtj2kDecoder(1, rgbLane);
      const units = decoder.plan(await colourInstance(photometric), Uint8Array);
      if ('declined' in units) throw new Error(units.declined);

      const pixels = await units[0].decode(
        new Uint8Array(8),
        new AbortController().signal
      );

      expect(Array.from(pixels.data)).toEqual(Array.from(RGB));
      expect(pixels).toMatchObject({ size: [2, 2, 1], components: 3 });
    }
  );

  it('rescales each frame by its own Pixel Value Transformation', async () => {
    const lane: Htj2kLane = {
      run: async () => ({
        bytes: new Uint8Array(Uint16Array.from([1, 2, 3, 4]).buffer),
        columns: 2,
        rows: 1,
        components: 1,
        bytesPerSample: 2,
      }),
      reset: () => {},
    };
    const { decoder } = createHtj2kDecoder(1, () => lane);
    const instance = await htj2kInstance({
      sopClassUid: '1.2.840.10008.5.1.4.1.1.2.1',
      rows: 1,
      columns: 2,
      frames: 2,
      frameRescales: [
        [1, 0],
        [2, 10],
      ],
    });
    const units = decoder.plan(instance, Int16Array);
    if ('declined' in units) throw new Error(units.declined);

    const pixels = await units[0].decode(
      new Uint8Array(8),
      new AbortController().signal
    );

    expect(Array.from(pixels.data)).toEqual([1, 2, 16, 18]);
    expect(pixels.range).toEqual([[1, 18]]);
  });

  it('declines colour no transform of the codestream turns into RGB', async () => {
    const { decoder } = createHtj2kDecoder(1, rgbLane);

    expect(decoder.plan(await colourInstance('YBR_FULL'), Uint8Array)).toEqual({
      declined: expect.stringMatching(/YBR_FULL/),
    });
  });
});
