import {
  InterfaceTypes,
  runPipeline,
  type Image,
  type TypedArray,
} from 'itk-wasm';
import type { DicomDataset } from '../metadata/dicomDataset';
import { assertUniformModalityRescale } from '../metadata/modalityRescale';
import { createMetadataReader } from './metadataReader';

export type DecodedDicomImage = {
  size: number[];
  data: Exclude<TypedArray, BigInt64Array | BigUint64Array>;
  imageType: { components: number };
};
export type DicomDecoder = (
  file: File,
  /** When supplied, this header must describe the same file. */
  metadata?: DicomDataset
) => Promise<{ image: DecodedDicomImage }>;
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

/** Reuses the GDCM image-io pipeline with explicit assets and one owned worker. */
export function createDicomDecoder(
  assets: DicomAssets,
  readMetadata?: ReturnType<typeof createMetadataReader>['read']
) {
  const ownedMetadata = readMetadata ? null : createMetadataReader();
  const read = readMetadata ?? ownedMetadata!.read;
  let worker: Worker | null = null;
  let disposed = false;
  let queue = Promise.resolve();
  let rejectActive: ((reason: unknown) => void) | undefined;
  const pending = new Set<(reason: unknown) => void>();
  const resetWorker = (reason: unknown) => {
    if (worker) {
      worker.removeEventListener('error', onError);
      worker.removeEventListener('messageerror', onMessageError);
      worker.terminate();
      worker = null;
    }
    rejectActive?.(reason);
  };
  const onError = () => resetWorker(new Error('DICOM decoder worker failed'));
  const onMessageError = () =>
    resetWorker(new Error('DICOM decoder worker message failed'));
  const assertActive = () => {
    if (disposed)
      throw new DOMException('DICOM decoder disposed', 'AbortError');
  };
  const decode: DicomDecoder = (file, metadata) =>
    new Promise((resolve, reject) => {
      if (disposed) {
        reject(new DOMException('DICOM decoder disposed', 'AbortError'));
        return;
      }
      pending.add(reject);
      const operation = queue.then(async () => {
        assertActive();
        const data = new Uint8Array(await file.arrayBuffer());
        assertActive();
        const header = metadata ?? (await read(data));
        assertActive();
        assertUniformModalityRescale(header);
        if (!worker) {
          worker = new Worker(assets.pipelineWorkerUrl, { type: 'module' });
          const ownedWorker = worker;
          const addEventListener = worker.addEventListener.bind(worker);
          // ITK attaches its message listener asynchronously, after creation.
          worker.addEventListener = (
            ...args: Parameters<Worker['addEventListener']>
          ) => {
            if (worker !== ownedWorker)
              throw new DOMException(
                'DICOM decoder worker stopped',
                'AbortError'
              );
            addEventListener(...args);
          };
          worker.addEventListener('error', onError);
          worker.addEventListener('messageerror', onMessageError);
        }
        const failed = new Promise<never>((_, rejectFailure) => {
          rejectActive = rejectFailure;
        });
        try {
          const result = await Promise.race([
            runPipeline(
              'gdcm-read-image',
              [file.name, '0', '1', '--memory-io'],
              [
                { type: InterfaceTypes.JsonCompatible },
                { type: InterfaceTypes.Image },
              ],
              [
                {
                  type: InterfaceTypes.BinaryFile,
                  data: { path: file.name, data },
                },
              ],
              {
                webWorker: worker,
                pipelineWorkerUrl: assets.pipelineWorkerUrl,
                pipelineBaseUrl: assets.imageIOUrl,
              }
            ),
            failed,
          ]);
          assertActive();
          return decodedImage(result);
        } finally {
          rejectActive = undefined;
        }
      });
      queue = operation.then(
        () => {},
        () => {}
      );
      operation.then(resolve, reject).finally(() => pending.delete(reject));
    });
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    const reason = new DOMException('DICOM decoder disposed', 'AbortError');
    resetWorker(reason);
    ownedMetadata?.dispose();
    pending.forEach((reject) => reject(reason));
    pending.clear();
  };
  return { decode, dispose };
}
