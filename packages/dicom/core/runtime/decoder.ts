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
export type DicomDecoder = (
  file: File
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
export function createDicomDecoder(assets: DicomAssets) {
  let worker: Worker | null = null;
  let disposed = false;
  let queue = Promise.resolve();
  const pending = new Set<(reason: unknown) => void>();
  const assertActive = () => {
    if (disposed)
      throw new DOMException('DICOM decoder disposed', 'AbortError');
  };
  const decode: DicomDecoder = (file) =>
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
        worker ??= new Worker(assets.pipelineWorkerUrl, { type: 'module' });
        const result = await runPipeline(
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
        );
        assertActive();
        return decodedImage(result);
      });
      queue = operation.then(
        () => {},
        () => {}
      );
      operation.then(resolve, reject).finally(() => pending.delete(reject));
    });
  const dispose = () => {
    disposed = true;
    pending.forEach((reject) =>
      reject(new DOMException('DICOM decoder disposed', 'AbortError'))
    );
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return { decode, dispose };
}
