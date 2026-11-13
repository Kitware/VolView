import type { ByteSource } from '../source/byteSource';
import { readInstance, type Instance } from '../instance/readInstance';
import type { ImageImportPolicy } from '../streaming/dicom/readDicomHeader';
import { RequestPool } from '../streaming/requestPool';
import { assertUniformModalityRescale } from '../metadata/modalityRescale';
import { abortError, linkedController, untilAborted } from '../utils/abort';
import {
  createMetadataReader,
  type MetadataReaderOptions,
} from './metadataReader';
import {
  defaultDecoderTable,
  wholeInstanceDecoderTable,
  type DecoderTable,
} from '../pixels/decoderTable';
import {
  createGdcmLane,
  type DecodedDicomImage,
  type DicomAssets,
} from './decoder';

/** The unit handed to a decoder: one whole instance and all of its bytes. */
export type DecodeRequest = { instance: Instance; bytes: Uint8Array };

/** Returned pixels belong to the caller; `bytes` may be transferred away. */
export type PixelDecoder = (
  request: DecodeRequest,
  signal: AbortSignal
) => Promise<DecodedDicomImage>;

export type DicomRuntimeOptions = MetadataReaderOptions & {
  fetch?: typeof fetch;
  requestConcurrency?: number;
  assets?: DicomAssets;
  /** Replaces the GDCM decoder; it owns its own resources. */
  decoder?: PixelDecoder;
  /**
   * Which transfer syntaxes decode natively per frame. Defaults to native
   * frames for uncompressed syntaxes, or, with a supplied `decoder`, to that
   * decoder for everything.
   */
  decoders?: DecoderTable;
  /** Concurrent decodes. Each GDCM worker carries its own WASM heap. */
  decodeConcurrency?: number;
  imageImportPolicy?: ImageImportPolicy;
};

const MAX_DEFAULT_DECODERS = 4;

/** Half the cores, at least one and at most four, so WASM heaps stay bounded. */
export const defaultDecodeConcurrency = (
  hardwareConcurrency: number | undefined
) =>
  Math.max(
    1,
    Math.min(MAX_DEFAULT_DECODERS, Math.floor((hardwareConcurrency || 2) / 2))
  );

/** Numbered slots handed out first come, first served. */
function createSlots(count: number) {
  const free = Array.from({ length: count }, (_, index) => count - 1 - index);
  const waiters: Array<(index: number) => void> = [];
  const acquire = (signal: AbortSignal) =>
    new Promise<number>((resolve, reject) => {
      if (signal.aborted) {
        reject(signal.reason);
        return;
      }
      if (free.length > 0) {
        resolve(free.pop()!);
        return;
      }
      const onAbort = () => {
        waiters.splice(waiters.indexOf(waiter), 1);
        reject(signal.reason);
      };
      const waiter = (index: number) => {
        signal.removeEventListener('abort', onAbort);
        resolve(index);
      };
      waiters.push(waiter);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  const release = (index: number) => {
    const next = waiters.shift();
    if (next) next(index);
    else free.push(index);
  };
  return { acquire, release };
}

function gdcmDecoder(assets: DicomAssets, count: number) {
  const lanes = Array.from({ length: count }, () => createGdcmLane(assets));
  const decodeOn = async (
    index: number,
    { instance, bytes }: DecodeRequest,
    signal: AbortSignal
  ) => {
    signal.throwIfAborted();
    assertUniformModalityRescale(instance.dataset);
    const lane = lanes[index];
    // GDCM cannot be interrupted, so an abort terminates the worker.
    const stop = () => lane.reset(signal.reason);
    signal.addEventListener('abort', stop, { once: true });
    try {
      return (await lane.run('instance.dcm', bytes)).image;
    } finally {
      signal.removeEventListener('abort', stop);
    }
  };
  const dispose = (reason: unknown) =>
    lanes.forEach((lane) => lane.reset(reason));
  return { decodeOn, dispose };
}

const missingDecoder = async (): Promise<DecodedDicomImage> => {
  throw new Error('Provide DICOM decoder assets or a decoder');
};

/**
 * Owns the request pool, the metadata workers and the decode pool. Nothing
 * else in the loading API needs disposal: aborting a signal stops one
 * operation, and `dispose` stops them all and settles what is pending.
 */
export function createDicomRuntime(options: DicomRuntimeOptions = {}) {
  const decodeConcurrency =
    options.decodeConcurrency ??
    defaultDecodeConcurrency(globalThis.navigator?.hardwareConcurrency);
  if (!Number.isInteger(decodeConcurrency) || decodeConcurrency < 1)
    throw new Error('Decode concurrency must be a positive integer');
  const lifetime = new AbortController();
  const requests = new RequestPool(options.requestConcurrency, options.fetch);
  const metadata = createMetadataReader(options);
  const slots = createSlots(decodeConcurrency);
  const gdcm =
    options.assets && !options.decoder
      ? gdcmDecoder(options.assets, decodeConcurrency)
      : null;
  const decodeOn = (
    index: number,
    request: DecodeRequest,
    signal: AbortSignal
  ) =>
    gdcm
      ? gdcm.decodeOn(index, request, signal)
      : (options.decoder ?? missingDecoder)(request, signal);

  const withLifetime = async <T>(
    signal: AbortSignal,
    run: (linked: AbortSignal) => Promise<T>
  ) => {
    const { controller, release } = linkedController(signal, lifetime.signal);
    try {
      return await untilAborted(run(controller.signal), controller.signal);
    } finally {
      release();
    }
  };

  const decode = (request: DecodeRequest, signal: AbortSignal) =>
    withLifetime(signal, async (linked) => {
      const index = await slots.acquire(linked);
      try {
        return await decodeOn(index, request, linked);
      } finally {
        slots.release(index);
      }
    });

  const read = (source: ByteSource, signal: AbortSignal) =>
    withLifetime(signal, (linked) =>
      readInstance(source, linked, {
        readDataset: metadata.read,
        imageImportPolicy: options.imageImportPolicy,
      })
    );

  const dispose = () => {
    if (lifetime.signal.aborted) return;
    const reason = abortError('DICOM runtime disposed');
    lifetime.abort(reason);
    requests.dispose();
    metadata.dispose();
    gdcm?.dispose(reason);
  };

  return {
    /** Pooled fetch for `fromUrl` sources; disposal aborts its requests. */
    fetch: requests.fetch,
    /** Aborts when the runtime is disposed. */
    signal: lifetime.signal,
    decodeConcurrency,
    decoders:
      options.decoders ??
      (options.decoder ? wholeInstanceDecoderTable : defaultDecoderTable),
    /** Concurrent requests, which also bounds how far reads run ahead of decoding. */
    readConcurrency: requests.poolSize,
    readInstance: read,
    decode,
    dispose,
  };
}

export type DicomRuntime = ReturnType<typeof createDicomRuntime>;
