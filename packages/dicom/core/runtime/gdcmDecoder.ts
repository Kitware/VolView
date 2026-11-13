import type { Image, runPipeline, TypedArray } from 'itk-wasm';
import type { Instance } from '../instance/readInstance';
import { assertUniformModalityRescale } from '../metadata/modalityRescale';
import { linkedController, untilAborted } from '../utils';
import {
  wholeInstanceDecoder,
  type DecodedPixels,
} from '../pixels/pixelDecoder';

export type DicomAssets = { pipelineWorkerUrl: string; imageIOUrl: string };

const numeric = (data: TypedArray) => {
  if (data instanceof BigInt64Array || data instanceof BigUint64Array)
    throw new Error('DICOM pixel arrays must contain numbers');
  return data;
};

function decodedPixels(
  result: Awaited<ReturnType<typeof runPipeline>>
): DecodedPixels {
  if (result.returnValue !== 0 || !result.outputs[0]?.data)
    throw new Error(result.stderr || 'Could not decode DICOM image');
  const image = result.outputs[1]?.data as Image;
  if (!image?.data) throw new Error('No pixel data decoded from DICOM image');
  const [columns, rows, frames = 1] = image.size;
  return {
    data: numeric(image.data),
    size: [columns, rows, frames],
    components: image.imageType.components,
  };
}

/**
 * One GDCM pipeline worker, created on first use. A worker error rejects the
 * running decode and drops the worker, so the next decode starts a fresh one.
 */
function createGdcmLane(assets: DicomAssets) {
  let worker: Worker | null = null;
  let rejectActive: ((reason: unknown) => void) | undefined;
  const reset = (reason: unknown) => {
    if (worker) {
      worker.removeEventListener('error', onError);
      worker.removeEventListener('messageerror', onMessageError);
      worker.terminate();
      worker = null;
    }
    rejectActive?.(reason);
  };
  const onError = () => reset(new Error('DICOM decoder worker failed'));
  const onMessageError = () =>
    reset(new Error('DICOM decoder worker message failed'));
  const startWorker = () => {
    const ownedWorker = new Worker(assets.pipelineWorkerUrl, {
      type: 'module',
    });
    worker = ownedWorker;
    const addEventListener = ownedWorker.addEventListener.bind(ownedWorker);
    // ITK attaches its message listener asynchronously, after creation.
    ownedWorker.addEventListener = (
      ...args: Parameters<Worker['addEventListener']>
    ) => {
      if (worker !== ownedWorker)
        throw new DOMException('DICOM decoder worker stopped', 'AbortError');
      addEventListener(...args);
    };
    ownedWorker.addEventListener('error', onError);
    ownedWorker.addEventListener('messageerror', onMessageError);
    return ownedWorker;
  };
  const run = async (name: string, data: Uint8Array) => {
    const failed = new Promise<never>((_, rejectFailure) => {
      rejectActive = rejectFailure;
    });
    try {
      // Loaded on first decode so the core entry point imports outside a browser.
      const itk = await Promise.race([import('itk-wasm'), failed]);
      const { InterfaceTypes } = itk;
      const result = await Promise.race([
        itk.runPipeline(
          'gdcm-read-image',
          [name, '0', '1', '--memory-io'],
          [
            { type: InterfaceTypes.JsonCompatible },
            { type: InterfaceTypes.Image },
          ],
          [{ type: InterfaceTypes.BinaryFile, data: { path: name, data } }],
          {
            webWorker: worker ?? startWorker(),
            pipelineWorkerUrl: assets.pipelineWorkerUrl,
            pipelineBaseUrl: assets.imageIOUrl,
            noCopy: true,
          }
        ),
        failed,
      ]);
      return decodedPixels(result);
    } finally {
      rejectActive = undefined;
    }
  };
  return { run, reset };
}

export type GdcmLane = ReturnType<typeof createGdcmLane>;
export type CreateGdcmLane = (assets: DicomAssets) => GdcmLane;

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

/**
 * Decodes whole instances on at most `count` GDCM workers at once, queueing
 * the rest. `dispose` settles running and queued decodes.
 */
export function createGdcmDecoder(
  assets: DicomAssets | undefined,
  count: number,
  createLane: CreateGdcmLane = createGdcmLane
) {
  const lifetime = new AbortController();
  const slots = createSlots(count);
  const lanes = assets
    ? Array.from({ length: count }, () => createLane(assets))
    : [];

  const decodeOn = async (
    index: number,
    instance: Instance,
    bytes: Uint8Array,
    signal: AbortSignal
  ) => {
    signal.throwIfAborted();
    const lane = lanes[index];
    if (!lane)
      throw new Error('GDCM decoding needs createDicomRuntime({ assets })');
    assertUniformModalityRescale(instance.dataset);
    // GDCM cannot be interrupted, so an abort terminates the worker.
    const stop = () => lane.reset(signal.reason);
    signal.addEventListener('abort', stop, { once: true });
    try {
      return await lane.run('instance.dcm', bytes);
    } finally {
      signal.removeEventListener('abort', stop);
    }
  };

  const decoder = wholeInstanceDecoder(
    'GDCM',
    async ({ instance, bytes }, signal) => {
      const { controller, release } = linkedController(signal, lifetime.signal);
      const linked = controller.signal;
      const pooled = async () => {
        const index = await slots.acquire(linked);
        try {
          return await decodeOn(index, instance, bytes, linked);
        } finally {
          slots.release(index);
        }
      };
      try {
        return await untilAborted(pooled(), linked);
      } finally {
        release();
      }
    }
  );

  const dispose = (reason: unknown) => {
    lifetime.abort(reason);
    lanes.forEach((lane) => lane.reset(reason));
  };

  return { decoder, dispose };
}
