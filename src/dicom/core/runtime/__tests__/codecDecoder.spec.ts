import { describe, expect, it } from 'vitest';
import { createCodecDecoders, type CodecLane } from '../codecDecoder';
import type { Instance } from '../../instance/readInstance';
import { pixelInstance, withNumber } from '../../pixels/__tests__/pixelFixture';
import type { PixelDecoder } from '../../pixels/pixelDecoder';
import type { VolumeBufferConstructor } from '../../volume/pixelFormat';
import type { NativePixelOptions } from '@/tests/nativePixelDicom';

const HTJ2K_LOSSLESS = '1.2.840.10008.1.2.4.201';

// Two by two pixels of three samples, as OpenJPH returns color.
const RGB = Uint8Array.from([
  10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120,
]);

/** A lane whose codec decodes every job to these two by two color samples. */
const colorLane = (samples: Uint8Array) => (): CodecLane => ({
  run: async () => ({
    bytes: samples.slice(),
    columns: 2,
    rows: 2,
    components: 3,
    bytesPerSample: 1,
    precision: 8,
  }),
  reset: () => {},
});
const rgbLane = colorLane(RGB);

// Gray, red, green and blue in full range YCbCr, and the RGB they convert to.
const YBR = Uint8Array.from([
  128, 128, 128, 76, 85, 255, 150, 44, 21, 29, 255, 107,
]);
const YBR_AS_RGB = [128, 128, 128, 254, 0, 0, 0, 255, 1, 0, 0, 254];

/** The pixels the decoder's one unit decodes for `instance`. */
async function decodeWhole(
  decoder: PixelDecoder,
  instance: Instance,
  Target: VolumeBufferConstructor
) {
  const units = decoder.plan(instance, Target);
  if ('declined' in units) throw new Error(units.declined);
  return units[0].decode(new Uint8Array(8), new AbortController().signal);
}

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

const colorInstance = (photometric: string) =>
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
    ['jpeg', 'YBR_PARTIAL_422'],
    ['jpeg', 'YBR_PARTIAL_420'],
  ] as const)(
    'decodes %s %s color to the RGB samples its codec returns',
    async (codec, photometric) => {
      const decoder = createCodecDecoders(1, rgbLane).decoders[codec];

      const pixels = await decodeWhole(
        decoder,
        await colorInstance(photometric),
        Uint8Array
      );

      expect(Array.from(pixels.data)).toEqual(Array.from(RGB));
      expect(pixels).toMatchObject({ size: [2, 2, 1], components: 3 });
    }
  );

  it.each([
    ['htj2k', 'YBR_FULL'],
    ['htj2k', 'YBR_FULL_422'],
    ['jpeg2000', 'YBR_FULL'],
    ['jpeg2000', 'YBR_FULL_422'],
    ['rle', 'YBR_FULL'],
    ['rle', 'YBR_FULL_422'],
    ['jpegLossless', 'YBR_FULL'],
    ['jpegLossless', 'YBR_FULL_422'],
    ['jpegLs', 'YBR_FULL'],
    ['jpegLs', 'YBR_FULL_422'],
  ] as const)(
    'converts the fully sampled YCbCr %s returns for %s to RGB',
    async (codec, photometric) => {
      const decoder = createCodecDecoders(1, colorLane(YBR)).decoders[codec];

      const pixels = await decodeWhole(
        decoder,
        await colorInstance(photometric),
        Uint8Array
      );

      expect(Array.from(pixels.data)).toEqual(YBR_AS_RGB);
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
        precision: 16,
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

    const pixels = await decodeWhole(decoder, instance, Int16Array);

    expect(Array.from(pixels.data)).toEqual([1, 2, 16, 18]);
    expect(pixels.range).toEqual([[1, 18]]);
  });

  it('declines color that nothing turns into RGB', async () => {
    const decoder = createCodecDecoders(1, rgbLane).decoders.htj2k;

    expect(
      decoder.plan(await colorInstance('YBR_PARTIAL_420'), Uint8Array)
    ).toEqual({ declined: expect.stringMatching(/YBR_PARTIAL_420/) });
  });

  it.each([16, 12])(
    'decodes JPEG samples held in %i bits allocated as whole 16 bit words',
    async (bitsAllocated) => {
      const shapes: unknown[] = [];
      const lane: CodecLane = {
        run: async ({ shape }) => {
          shapes.push(shape);
          return {
            ...shape,
            precision: 12,
            bytes: new Uint8Array(Uint16Array.from([0x0abc, 0xffff]).buffer),
          };
        },
        reset: () => {},
      };
      const { jpeg } = createCodecDecoders(1, () => lane).decoders;
      const instance = await encapsulatedInstance({
        rows: 1,
        columns: 2,
        bitsStored: 12,
      });

      const pixels = await decodeWhole(
        jpeg,
        withNumber(instance, '00280100', bitsAllocated),
        Uint16Array
      );

      expect(shapes).toEqual([
        { columns: 2, rows: 1, components: 1, bytesPerSample: 2 },
      ]);
      expect(Array.from(pixels.data)).toEqual([0x0abc, 0x0fff]);
    }
  );

  it.each([
    ['a delimited fragment sequence to its end', true],
    ['a fragment sequence of defined length within that length', false],
  ])('reads %s', async (_name, delimited) => {
    const { instance } = await pixelInstance({ rows: 1, columns: 2 });
    const { valueOffset: start, length } = instance.pixelData!;
    const { rle } = createCodecDecoders(1, rgbLane).decoders;

    const units = rle.plan(
      delimited
        ? { ...instance, pixelData: { ...instance.pixelData!, length: null } }
        : instance,
      Uint16Array
    );

    expect('declined' in units ? units : units[0].range).toEqual(
      delimited ? { start } : { start, end: start + length! }
    );
  });

  it('hands the worker what the header says and a codestream may not', async () => {
    const jobs: unknown[] = [];
    const lane: CodecLane = {
      run: async (job) => {
        jobs.push({ ...job, value: job.value.length });
        return { ...job.shape, precision: 16, bytes: new Uint8Array(24) };
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

    const pixels = await decodeWhole(rle, instance, Uint16Array);

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
        precision: 16,
        bytes: new Uint8Array(48),
      }),
      reset: () => {},
    };
    const { rle } = createCodecDecoders(1, () => lane).decoders;

    await expect(
      decodeWhole(
        rle,
        await encapsulatedInstance({ rows: 2, columns: 3 }),
        Uint16Array
      )
    ).rejects.toThrow(
      'RLE frames decode to 3x4, 1 samples of 16 bits; the header declares 3x2, 1 samples of 16 bits'
    );
  });

  it.each([
    ['jpeg2000', 'keeps', [644, 3]],
    ['jpegLossless', 'masks off', [132, 3]],
  ] as const)(
    '%s %s the bits a codestream holds beyond Bits Stored',
    async (codec, _rule, samples) => {
      const lane: CodecLane = {
        run: async (job) => ({
          ...job.shape,
          precision: 10,
          bytes: new Uint8Array(Uint16Array.from([644, 3]).buffer),
        }),
        reset: () => {},
      };
      const decoder = createCodecDecoders(1, () => lane).decoders[codec];

      const pixels = await decodeWhole(
        decoder,
        await encapsulatedInstance({ rows: 1, columns: 2, bitsStored: 8 }),
        Uint16Array
      );

      expect(Array.from(pixels.data)).toEqual(samples);
    }
  );
});
