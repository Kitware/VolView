import type { ByteSource } from '../source/byteSource';
import { readInstance } from '../instance/readInstance';
import { RequestPool } from './requestPool';
import { abortError, linkedController, untilAborted } from '../utils';
import { createMetadataReader } from './metadataReader';
import {
  defaultDecoderTable,
  type DecoderTable,
  type RuntimeDecoders,
} from '../pixels/decoderTable';
import {
  createGdcmDecoder,
  type CreateGdcmLane,
  type DicomAssets,
} from './gdcmDecoder';
import { createCodecDecoders, type CreateCodecLane } from './codecDecoder';

export type DicomRuntimeOptions = {
  fetch?: typeof fetch;
  assets?: DicomAssets;
  /** Builds the decoder table around the runtime's worker-backed decoders. */
  decoders?: (decoders: RuntimeDecoders) => DecoderTable;
  /**
   * Workers per worker-backed decoder, and the decodes one volume runs at
   * once. Each worker carries its own WASM heap and starts on first use.
   */
  decodeConcurrency?: number;
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

/**
 * Owns the request pool and the metadata, GDCM and codec workers. Nothing
 * else in the loading API needs disposal: aborting a signal stops one
 * operation, and `dispose` stops them all and settles what is pending.
 */
export function createDicomRuntime(
  options: DicomRuntimeOptions = {},
  createGdcmLane?: CreateGdcmLane,
  createCodecLane?: CreateCodecLane
) {
  const decodeConcurrency =
    options.decodeConcurrency ??
    defaultDecodeConcurrency(globalThis.navigator?.hardwareConcurrency);
  if (!Number.isInteger(decodeConcurrency) || decodeConcurrency < 1)
    throw new Error('Decode concurrency must be a positive integer');
  const lifetime = new AbortController();
  const requests = new RequestPool(undefined, options.fetch);
  const metadata = createMetadataReader();
  const gdcm = createGdcmDecoder(
    options.assets,
    decodeConcurrency,
    createGdcmLane
  );
  const codecs = createCodecDecoders(decodeConcurrency, createCodecLane);

  const read = async (source: ByteSource, signal: AbortSignal) => {
    const { controller, release } = linkedController(signal, lifetime.signal);
    try {
      return await untilAborted(
        readInstance(source, controller.signal, { readDataset: metadata.read }),
        controller.signal
      );
    } finally {
      release();
    }
  };

  const dispose = () => {
    if (lifetime.signal.aborted) return;
    const reason = abortError('DICOM runtime disposed');
    lifetime.abort(reason);
    requests.dispose(reason);
    metadata.dispose(reason);
    gdcm.dispose(reason);
    codecs.dispose(reason);
  };

  return {
    /** Pooled fetch for `fromUrl` sources; disposal aborts its requests. */
    fetch: requests.fetch,
    /** Aborts when the runtime is disposed. */
    signal: lifetime.signal,
    decodeConcurrency,
    decoders: (options.decoders ?? defaultDecoderTable)({
      gdcm: gdcm.decoder,
      ...codecs.decoders,
    }),
    /** Requests awaiting headers at once; also how far reads run ahead of decoding. */
    readConcurrency: requests.poolSize,
    readInstance: read,
    dispose,
  };
}

export type DicomRuntime = ReturnType<typeof createDicomRuntime>;
