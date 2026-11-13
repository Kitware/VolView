import {
  InterfaceTypes,
  runPipeline,
  type Image,
  type TypedArray,
} from 'itk-wasm';

export type DecodedDicomImage = {
  size: number[];
  data: Exclude<TypedArray, BigInt64Array | BigUint64Array>;
  imageType: { components: number };
};
export type DicomAssets = { pipelineWorkerUrl: string; imageIOUrl: string };

function decodedImage(result: Awaited<ReturnType<typeof runPipeline>>) {
  if (result.returnValue !== 0 || !result.outputs[0]?.data)
    throw new Error(result.stderr || 'Could not decode DICOM image');
  const image = result.outputs[1]?.data as Image;
  if (!image?.data) throw new Error('No pixel data decoded from DICOM image');
  if (
    image.data instanceof BigInt64Array ||
    image.data instanceof BigUint64Array
  )
    throw new Error('DICOM pixel arrays must contain numbers');
  return {
    image: {
      size: image.size,
      data: image.data,
      imageType: { components: image.imageType.components },
    },
  };
}

/**
 * One GDCM pipeline worker, created on first use. A worker error rejects the
 * running decode and drops the worker, so the next decode starts a fresh one.
 */
export function createGdcmLane(assets: DicomAssets) {
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
    const active = worker ?? startWorker();
    const failed = new Promise<never>((_, rejectFailure) => {
      rejectActive = rejectFailure;
    });
    try {
      const result = await Promise.race([
        runPipeline(
          'gdcm-read-image',
          [name, '0', '1', '--memory-io'],
          [
            { type: InterfaceTypes.JsonCompatible },
            { type: InterfaceTypes.Image },
          ],
          [{ type: InterfaceTypes.BinaryFile, data: { path: name, data } }],
          {
            webWorker: active,
            pipelineWorkerUrl: assets.pipelineWorkerUrl,
            pipelineBaseUrl: assets.imageIOUrl,
            noCopy: true,
          }
        ),
        failed,
      ]);
      return decodedImage(result);
    } finally {
      rejectActive = undefined;
    }
  };
  return { run, reset };
}
