import * as Comlink from 'comlink';
import type { Instance } from '../instance/readInstance';
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

/** The photometric interpretations a codestream's colour transform requires. */
const COLOUR_TRANSFORMED = ['YBR_RCT', 'YBR_ICT'];

// The codec undoes a colour transform itself, so those samples come back RGB.
const colourTransformedAsRgb = (format: NativePixelFormat) =>
  COLOUR_TRANSFORMED.includes(format.photometricInterpretation)
    ? { ...format, photometricInterpretation: 'RGB' }
    : format;

type Codec = Readonly<{
  name: string;
  maxBitsAllocated: number;
  /** The format of the samples the codec returns, where not the header's. */
  decodedAs?: (format: NativePixelFormat) => NativePixelFormat;
}>;

const CODECS: Record<CodecName, Codec> = {
  htj2k: {
    name: 'HTJ2K',
    maxBitsAllocated: 16,
    decodedAs: colourTransformedAsRgb,
  },
  jpeg2000: {
    name: 'JPEG 2000',
    maxBitsAllocated: 16,
    decodedAs: colourTransformedAsRgb,
  },
  jpegLs: { name: 'JPEG-LS', maxBitsAllocated: 16 },
  rle: { name: 'RLE', maxBitsAllocated: 32 },
};

type CodecCapability =
  | Readonly<{ format: NativePixelFormat; valueOffset: number }>
  | Readonly<{ declined: string }>;

function codecCapability(instance: Instance, codec: Codec): CodecCapability {
  const { pixelData } = instance;
  if (!pixelData) return { declined: 'The header locates no Pixel Data' };
  if (pixelData.length !== null)
    return { declined: 'Pixel Data is not encapsulated' };
  const capability = nativeCapability(instance, true, codec.decodedAs);
  if (capability.kind === 'declined') return { declined: capability.reason };
  const { format } = capability;
  if (format.bitsAllocated > codec.maxBitsAllocated)
    return { declined: `Bits Allocated ${format.bitsAllocated}` };
  return {
    format: { ...format, planar: false },
    valueOffset: pixelData.valueOffset,
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
    const { format, valueOffset } = capability;
    const frames = frameCount(instance.dataset);
    const formats = frameFormats(format, instance.dataset, frames);
    const shape = shapeOf(format);
    return [
      {
        firstFrame: 0,
        frames,
        range: { start: valueOffset },
        decode: async (bytes, signal) => {
          const job = {
            codec: name,
            value: ownedBytes(bytes),
            frameCount: frames,
            shape,
          };
          const decoded = await pool.run(job, signal);
          checkShape(CODECS[name].name, decoded, shape);
          return decodeNativeFrames(decoded.bytes, formats, Target);
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
      jpeg2000: codecDecoder('jpeg2000', pool),
      jpegLs: codecDecoder('jpegLs', pool),
      rle: codecDecoder('rle', pool),
    },
    dispose: pool.dispose,
  };
}
