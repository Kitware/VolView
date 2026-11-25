import * as Comlink from 'comlink';
import type { Instance } from '../instance/readInstance';
import type { DecodedFrames } from '../pixels/htj2kFrames';
import type { Htj2kWorker } from '../pixels/htj2k.worker';
import {
  decodeNativeFrame,
  nativeCapability,
  type NativePixelFormat,
} from '../pixels/nativeFrame';
import {
  frameCount,
  type DecodedPixels,
  type PixelDecoder,
} from '../pixels/pixelDecoder';
import type { VolumeBufferConstructor } from '../volume/pixelFormat';
import { createLanePool, type Lane } from './lanePool';

type Htj2kJob = Readonly<{ value: Uint8Array; frameCount: number }>;
export type Htj2kLane = Lane<Htj2kJob, DecodedFrames>;
export type CreateHtj2kLane = () => Htj2kLane;

const createHtj2kWorker = () =>
  new Worker(new URL('../pixels/htj2k.worker.ts', import.meta.url), {
    type: 'module',
  });

/**
 * One HTJ2K worker, created on first use. A worker error rejects the running
 * decode and drops the worker, so the next decode starts a fresh one.
 */
function createHtj2kLane(): Htj2kLane {
  let worker: { worker: Worker; remote: Comlink.Remote<Htj2kWorker> } | null =
    null;
  let rejectActive: ((reason: unknown) => void) | undefined;
  const reset = (reason: unknown) => {
    if (worker) {
      worker.remote[Comlink.releaseProxy]();
      worker.worker.terminate();
      worker = null;
    }
    rejectActive?.(reason);
  };
  const start = () => {
    const created = createHtj2kWorker();
    created.addEventListener('error', () =>
      reset(new Error('HTJ2K decoder worker failed'))
    );
    created.addEventListener('messageerror', () =>
      reset(new Error('HTJ2K decoder worker message failed'))
    );
    worker = { worker: created, remote: Comlink.wrap<Htj2kWorker>(created) };
    return worker;
  };
  const run = async ({ value, frameCount: frames }: Htj2kJob) => {
    const failed = new Promise<never>((_, reject) => {
      rejectActive = reject;
    });
    try {
      const { remote } = worker ?? start();
      return await Promise.race([
        remote.decode(Comlink.transfer(value, [value.buffer]), frames),
        failed,
      ]);
    } finally {
      rejectActive = undefined;
    }
  };
  return { run, reset };
}

type Htj2kCapability =
  | Readonly<{ format: NativePixelFormat; valueOffset: number }>
  | Readonly<{ declined: string }>;

// OpenJPH undoes a colour transform itself, so its samples are those stored.
function htj2kCapability(instance: Instance): Htj2kCapability {
  const { pixelData } = instance;
  if (!pixelData) return { declined: 'The header locates no Pixel Data' };
  if (pixelData.length !== null)
    return { declined: 'Pixel Data is not encapsulated' };
  const capability = nativeCapability(instance, true);
  if (capability.kind === 'declined') return { declined: capability.reason };
  const { format } = capability;
  if (format.bitsAllocated > 16)
    return { declined: `Bits Allocated ${format.bitsAllocated}` };
  return {
    format: { ...format, planar: false },
    valueOffset: pixelData.valueOffset,
  };
}

function checkShape(decoded: DecodedFrames, format: NativePixelFormat) {
  const decodedShape = `${decoded.columns}x${decoded.rows}, ${decoded.components} samples of ${decoded.bytesPerSample * 8} bits`;
  const declared = `${format.columns}x${format.rows}, ${format.samplesPerPixel} samples of ${format.bitsAllocated} bits`;
  if (decodedShape !== declared)
    throw new Error(
      `HTJ2K frames decode to ${decodedShape}; the header declares ${declared}`
    );
}

/** Interleaved samples of every frame, finished as native frames are. */
function toPixels(
  decoded: DecodedFrames,
  format: NativePixelFormat,
  frames: number,
  Target: VolumeBufferConstructor
): DecodedPixels {
  checkShape(decoded, format);
  const { columns, rows, samplesPerPixel: components } = format;
  const count = columns * rows * components;
  const frameLength = count * decoded.bytesPerSample;
  const data = new Target(count * frames);
  const ranges = Array.from({ length: frames }, (_, frame) => {
    const { samples, range } = decodeNativeFrame(
      decoded.bytes.subarray(frame * frameLength),
      format,
      Target
    );
    data.set(samples, frame * count);
    return range;
  });
  const range = Array.from({ length: components }, (_, component) => {
    const each = ranges.map((frameRange) => frameRange[component]);
    return [
      Math.min(...each.map(([low]) => low)),
      Math.max(...each.map(([, high]) => high)),
    ] as const;
  });
  return { data, size: [columns, rows, frames], components, range };
}

// The worker takes ownership of what it is sent.
const ownedBytes = (bytes: Uint8Array) =>
  bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? bytes
    : bytes.slice();

/**
 * Decodes HTJ2K instances whole on at most `count` workers at once, from a
 * read of their Pixel Data. `dispose` settles running and queued decodes.
 */
export function createHtj2kDecoder(
  count: number,
  createLane: CreateHtj2kLane = createHtj2kLane
) {
  const pool = createLanePool(Array.from({ length: count }, createLane));

  const decoder: PixelDecoder = {
    name: 'HTJ2K',
    plan: (instance, Target) => {
      const capability = htj2kCapability(instance);
      if ('declined' in capability) return capability;
      const { format, valueOffset } = capability;
      const frames = frameCount(instance.dataset);
      return [
        {
          firstFrame: 0,
          frames,
          range: { start: valueOffset },
          decode: async (bytes, signal) => {
            const job = { value: ownedBytes(bytes), frameCount: frames };
            const decoded = await pool.run(job, signal);
            return toPixels(decoded, format, frames, Target);
          },
        },
      ];
    },
  };

  return { decoder, dispose: pool.dispose };
}
