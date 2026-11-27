import * as Comlink from 'comlink';
import type { Instance } from '../instance/readInstance';
import { getDatasetTag } from '../metadata/datasetAccess';
import { Tags } from '../metadata/dicomTags';
import type { CodecWorker } from '../pixels/codec.worker';
import type {
  CodecJob,
  CodecName,
  DecodedFrames,
  FrameShape,
} from '../pixels/codecFrames';
import {
  decodeNativeFrames,
  frameFormats,
  nativeCapability,
  type NativePixelFormat,
} from '../pixels/nativeFrame';
import { frameCount, type PixelDecoder } from '../pixels/pixelDecoder';
import type { ByteRange } from '../source/byteSource';
import { trimDicomPadding } from '../utils';
import { createComlinkLane } from './comlinkLane';
import { createLanePool, type Lane } from './lanePool';

export type CodecLane = Lane<CodecJob, DecodedFrames>;
export type CreateCodecLane = () => CodecLane;

const createCodecWorker = () =>
  new Worker(new URL('../pixels/codec.worker.ts', import.meta.url), {
    type: 'module',
  });

const createCodecLane = (): CodecLane =>
  createComlinkLane<CodecWorker, CodecJob, DecodedFrames>(
    createCodecWorker,
    'DICOM codec',
    (remote, job) =>
      remote.decode(Comlink.transfer(job, [job.value.buffer as ArrayBuffer]))
  );

const decodedFrom =
  (photometrics: string[], photometricInterpretation: string) =>
  (format: NativePixelFormat) =>
    photometrics.includes(format.photometricInterpretation)
      ? { ...format, photometricInterpretation }
      : format;

// The codec undoes a codestream's color transform, so those samples come back RGB.
const colorTransformedAsRgb = decodedFrom(['YBR_RCT', 'YBR_ICT'], 'RGB');

// libjpeg-turbo converts the YCbCr a JPEG stream holds to RGB.
const jpegColorAsRgb = decodedFrom(
  ['YBR_FULL', 'YBR_FULL_422', 'YBR_PARTIAL_422', 'YBR_PARTIAL_420'],
  'RGB'
);

// A codec hands back every sample of every pixel, whatever a stream subsamples.
const fullySampled = decodedFrom(['YBR_FULL_422'], 'YBR_FULL');

const codestreamColor = (format: NativePixelFormat) =>
  fullySampled(colorTransformedAsRgb(format));

type Codec = Readonly<{
  name: string;
  maxBitsAllocated: number;
  /** The format of the samples the codec returns, where not the header's. */
  decodedAs: (format: NativePixelFormat) => NativePixelFormat;
  /**
   * Whether a codestream precision above Bits Stored is kept, as GDCM and
   * pydicom keep a JPEG 2000 stream's. Other streams carry unused high bits
   * that Bits Stored masks off.
   */
  keepsPrecision?: boolean;
}>;

const CODECS: Record<CodecName, Codec> = {
  htj2k: {
    name: 'HTJ2K',
    maxBitsAllocated: 16,
    decodedAs: codestreamColor,
    keepsPrecision: true,
  },
  jpeg: { name: 'JPEG', maxBitsAllocated: 16, decodedAs: jpegColorAsRgb },
  jpeg2000: {
    name: 'JPEG 2000',
    maxBitsAllocated: 16,
    decodedAs: codestreamColor,
    keepsPrecision: true,
  },
  jpegLossless: {
    name: 'JPEG Lossless',
    maxBitsAllocated: 16,
    decodedAs: fullySampled,
  },
  jpegLs: { name: 'JPEG-LS', maxBitsAllocated: 16, decodedAs: fullySampled },
  rle: { name: 'RLE', maxBitsAllocated: 32, decodedAs: fullySampled },
};

type CodecCapability =
  | Readonly<{ format: NativePixelFormat; range: ByteRange }>
  | Readonly<{ declined: string }>;

function codecCapability(instance: Instance, codec: Codec): CodecCapability {
  const { pixelData } = instance;
  if (!pixelData) return { declined: 'The header locates no Pixel Data' };
  const capability = nativeCapability(instance, true, codec.decodedAs);
  if (capability.kind === 'declined') return { declined: capability.reason };
  const { format } = capability;
  if (format.bitsAllocated > codec.maxBitsAllocated)
    return { declined: `Bits Allocated ${format.bitsAllocated}` };
  const start = pixelData.valueOffset;
  return {
    // A codec returns whole bytes of interleaved samples.
    format: {
      ...format,
      planar: false,
      bitsAllocated: Math.ceil(format.bitsAllocated / 8) * 8,
    },
    // Some writers give the fragment sequence a length instead of a delimiter.
    range:
      pixelData.length === null
        ? { start }
        : { start, end: start + pixelData.length },
  };
}

const shapeOf = (format: NativePixelFormat): FrameShape => ({
  columns: format.columns,
  rows: format.rows,
  components: format.samplesPerPixel,
  bytesPerSample: format.bitsAllocated / 8,
});

const describe = (shape: FrameShape) =>
  `${shape.columns}x${shape.rows}, ${shape.components} samples of ${shape.bytesPerSample * 8} bits`;

function checkShape(name: string, decoded: FrameShape, declared: FrameShape) {
  if (describe(decoded) !== describe(declared))
    throw new Error(
      `${name} frames decode to ${describe(decoded)}; the header declares ${describe(declared)}`
    );
}

/** `formats` with Bits Stored raised to a codestream precision that exceeds it. */
const holding = (formats: NativePixelFormat[], precision: number) =>
  precision > formats[0].bitsStored
    ? formats.map((format) => ({
        ...format,
        bitsStored: precision,
      }))
    : formats;

// The worker takes ownership of what it is sent.
const ownedBytes = (bytes: Uint8Array) =>
  bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? bytes
    : bytes.slice();

type CodecPool = ReturnType<typeof createLanePool<CodecJob, DecodedFrames>>;

/** Reads an instance's Pixel Data whole and finishes each frame as a native one. */
const codecDecoder = (name: CodecName, pool: CodecPool): PixelDecoder => ({
  name: CODECS[name].name,
  plan: (instance, Target) => {
    const capability = codecCapability(instance, CODECS[name]);
    if ('declined' in capability) return capability;
    const { format, range } = capability;
    const frames = frameCount(instance.dataset);
    const formats = frameFormats(format, instance.dataset, frames);
    const shape = shapeOf(format);
    const photometricInterpretation = trimDicomPadding(
      getDatasetTag(instance.dataset, Tags.PhotometricInterpretation) ?? ''
    );
    return [
      {
        firstFrame: 0,
        frames,
        range,
        decode: async (bytes, signal) => {
          const job = {
            codec: name,
            value: ownedBytes(bytes),
            frameCount: frames,
            shape,
            photometricInterpretation,
          };
          const decoded = await pool.run(job, signal);
          checkShape(CODECS[name].name, decoded, shape);
          return decodeNativeFrames(
            decoded.bytes,
            CODECS[name].keepsPrecision
              ? holding(formats, decoded.precision)
              : formats,
            Target
          );
        },
      },
    ];
  },
});

/**
 * One decoder per codec, all decoding on at most `count` shared workers at
 * once. `dispose` settles running and queued decodes.
 */
export function createCodecDecoders(
  count: number,
  createLane: CreateCodecLane = createCodecLane
) {
  const pool = createLanePool(Array.from({ length: count }, createLane));
  return {
    decoders: {
      htj2k: codecDecoder('htj2k', pool),
      jpeg: codecDecoder('jpeg', pool),
      jpeg2000: codecDecoder('jpeg2000', pool),
      jpegLossless: codecDecoder('jpegLossless', pool),
      jpegLs: codecDecoder('jpegLs', pool),
      rle: codecDecoder('rle', pool),
    },
    dispose: pool.dispose,
  };
}
