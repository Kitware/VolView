import type { Image, runPipeline, TypedArray } from 'itk-wasm';
import { getDatasetTag, isMonochrome1 } from '../metadata/datasetAccess';
import type { DicomDataset } from '../metadata/dicomDataset';
import { Tags } from '../metadata/dicomTags';
import {
  hasUniformModalityRescale,
  readModalityRescale,
} from '../metadata/modalityRescale';
import { numberOr } from '../utils';
import { createLanePool, type Lane } from './lanePool';
import { asPart10 } from './part10Bytes';
import {
  wholeInstanceDecoder,
  type DecodedPixels,
  type PixelDecoder,
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
  const run = async (data: Uint8Array) => {
    const name = 'instance.dcm';
    const failed = new Promise<never>((_, rejectFailure) => {
      rejectActive = rejectFailure;
    });
    try {
      // Loaded on first decode so core imports outside a browser.
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

/**
 * GDCM reflects MONOCHROME1 stored values across their range, then rescales.
 * Reflecting its output back gives the stored values, as native frames keep.
 */
function restoreMonochrome1(pixels: DecodedPixels, dataset: DicomDataset) {
  const bitsStored = numberOr(getDatasetTag(dataset, Tags.BitsStored), NaN);
  const signed =
    numberOr(getDatasetTag(dataset, Tags.PixelRepresentation), 0) === 1;
  const { rescaleSlope, rescaleIntercept } = readModalityRescale(dataset);
  const [low, high] = signed
    ? [-(2 ** (bitsStored - 1)), 2 ** (bitsStored - 1) - 1]
    : [0, 2 ** bitsStored - 1];
  const mirror = rescaleSlope * (low + high) + 2 * rescaleIntercept;
  // The lane hands back a buffer it owns, and the reflection stays in range.
  const data = pixels.data as { length: number; [index: number]: number };
  for (let index = 0; index < data.length; index += 1)
    data[index] = mirror - data[index];
  return pixels;
}

export type GdcmLane = Lane<Uint8Array, DecodedPixels>;
export type CreateGdcmLane = (assets: DicomAssets) => GdcmLane;

/**
 * Decodes whole instances on at most `count` GDCM workers at once, queueing
 * the rest. `dispose` settles running and queued decodes.
 */
export function createGdcmDecoder(
  assets: DicomAssets | undefined,
  count: number,
  createLane: CreateGdcmLane = createGdcmLane
) {
  const pool = createLanePool(
    assets ? Array.from({ length: count }, () => createLane(assets)) : []
  );

  const whole = wholeInstanceDecoder('GDCM', async (unit, signal) => {
    signal.throwIfAborted();
    if (!assets)
      throw new Error('GDCM decoding needs createDicomRuntime({ assets })');
    const pixels = await pool.run(asPart10(unit.instance, unit.bytes), signal);
    const { dataset } = unit.instance;
    return isMonochrome1(dataset)
      ? restoreMonochrome1(pixels, dataset)
      : pixels;
  });

  // GDCM applies one transform to an instance, so its frames must agree.
  const decoder: PixelDecoder = {
    ...whole,
    plan: (instance, target) =>
      hasUniformModalityRescale(instance.dataset)
        ? whole.plan(instance, target)
        : { declined: 'Frames with differing modality rescale' },
  };

  return { decoder, dispose: pool.dispose };
}
