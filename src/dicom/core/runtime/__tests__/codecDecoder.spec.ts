import { describe, expect, it } from 'vitest';
import { createCodecDecoders, type CodecLane } from '../codecDecoder';
import { pixelInstance } from '../../pixels/__tests__/pixelFixture';
import type { NativePixelOptions } from '@/tests/nativePixelDicom';

const HTJ2K_LOSSLESS = '1.2.840.10008.1.2.4.201';

// Two by two pixels of three samples, as OpenJPH returns colour.
const RGB = Uint8Array.from([
  10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120,
]);

const rgbLane = (): CodecLane => ({
  run: async () => ({
    bytes: RGB.slice(),
    columns: 2,
    rows: 2,
    components: 3,
    bytesPerSample: 1,
  }),
  reset: () => {},
});

/** The header of an instance whose Pixel Data is encapsulated. */
async function encapsulatedInstance(options: NativePixelOptions) {
  const { instance } = await pixelInstance(options);
  return {
    ...instance,
    pixelData: { ...instance.pixelData!, length: null },
  };
}

const htj2kInstance = async (options: NativePixelOptions) => ({
  ...(await encapsulatedInstance(options)),
  transferSyntaxUid: HTJ2K_LOSSLESS,
});

const colourInstance = (photometric: string) =>
  htj2kInstance({
    rows: 2,
    columns: 2,
    samplesPerPixel: 3,
    bitsAllocated: 8,
    photometric,
  });

describe('codec decoders', () => {
  it.each([
    ['htj2k', 'RGB'],
    ['htj2k', 'YBR_RCT'],
    ['htj2k', 'YBR_ICT'],
    ['jpeg2000', 'YBR_RCT'],
    ['jpeg2000', 'YBR_ICT'],
    ['jpeg', 'YBR_FULL'],
    ['jpeg', 'YBR_FULL_422'],
  ] as const)(
    'decodes %s %s colour to the RGB samples its codec returns',
    async (codec, photometric) => {
      const decoder = createCodecDecoders(1, rgbLane).decoders[codec];
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
    const lane: CodecLane = {
      run: async () => ({
        bytes: new Uint8Array(Uint16Array.from([1, 2, 3, 4]).buffer),
        columns: 2,
        rows: 1,
        components: 1,
        bytesPerSample: 2,
      }),
      reset: () => {},
    };
    const decoder = createCodecDecoders(1, () => lane).decoders.htj2k;
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
    const decoder = createCodecDecoders(1, rgbLane).decoders.htj2k;

    expect(decoder.plan(await colourInstance('YBR_FULL'), Uint8Array)).toEqual({
      declined: expect.stringMatching(/YBR_FULL/),
    });
  });

  it('declines JPEG samples over 8 bits, which are the 12 bit process', async () => {
    const { jpeg, jpegLossless } = createCodecDecoders(1, rgbLane).decoders;
    const instance = await encapsulatedInstance({ bitsStored: 12 });

    expect(jpeg.plan(instance, Uint16Array)).toEqual({
      declined: 'Bits Allocated 16',
    });
    expect(jpegLossless.plan(instance, Uint16Array)).toMatchObject([
      { firstFrame: 0, frames: 1 },
    ]);
  });

  it('hands the worker what the header says and a codestream may not', async () => {
    const jobs: unknown[] = [];
    const lane: CodecLane = {
      run: async (job) => {
        jobs.push({ ...job, value: job.value.length });
        return { ...job.shape, bytes: new Uint8Array(24) };
      },
      reset: () => {},
    };
    const { rle } = createCodecDecoders(1, () => lane).decoders;
    const instance = await encapsulatedInstance({
      rows: 2,
      columns: 3,
      frames: 2,
      planarConfiguration: 1,
    });
    const units = rle.plan(instance, Uint16Array);
    if ('declined' in units) throw new Error(units.declined);

    const pixels = await units[0].decode(
      new Uint8Array(8),
      new AbortController().signal
    );

    expect(jobs).toEqual([
      {
        codec: 'rle',
        value: 8,
        frameCount: 2,
        shape: { columns: 3, rows: 2, components: 1, bytesPerSample: 2 },
        photometricInterpretation: 'MONOCHROME2',
      },
    ]);
    expect(pixels).toMatchObject({ size: [3, 2, 2], components: 1 });
  });

  it('rejects frames a codec decodes to another shape than the header declares', async () => {
    const lane: CodecLane = {
      run: async (job) => ({
        ...job.shape,
        rows: 4,
        bytes: new Uint8Array(48),
      }),
      reset: () => {},
    };
    const { rle } = createCodecDecoders(1, () => lane).decoders;
    const units = rle.plan(
      await encapsulatedInstance({ rows: 2, columns: 3 }),
      Uint16Array
    );
    if ('declined' in units) throw new Error(units.declined);

    await expect(
      units[0].decode(new Uint8Array(8), new AbortController().signal)
    ).rejects.toThrow(
      'RLE frames decode to 3x4, 1 samples of 16 bits; the header declares 3x2, 1 samples of 16 bits'
    );
  });
});
