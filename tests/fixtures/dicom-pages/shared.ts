import {
  createDicomRuntime,
  type DicomRuntimeOptions,
} from '@/src/dicom/core/runtime/createDicomRuntime';
import { fromBlob, fromUrl } from '@/src/dicom/core/source/byteSource';
import {
  planDecode,
  singleDecoderTable,
} from '@/src/dicom/core/pixels/decoderTable';
import type { Instance } from '@/src/dicom/core/instance/readInstance';

export const assetUrls = (
  pipelineWorker = './assets/itk-wasm-pipeline.min.worker.js'
) => ({
  pipelineWorkerUrl: new URL(pipelineWorker, document.baseURI).href,
  imageIOUrl: new URL('./assets/image-io', document.baseURI).href,
});

const runtimes: Array<{ dispose: () => void }> = [];

export const createRuntime = (options: DicomRuntimeOptions = {}) => {
  const runtime = createDicomRuntime({ assets: assetUrls(), ...options });
  runtimes.push(runtime);
  return runtime;
};

export const runtime = createRuntime();

/** Pages never cancel; disposing the runtime stops everything on pagehide. */
export const never = new AbortController().signal;

/** Runtime options that send every instance whole to GDCM. */
export const gdcmOnly = { decoders: singleDecoderTable };

/** The first unit `decoding`'s table plans for an instance. */
export function firstUnit(
  decoding: Pick<ReturnType<typeof createDicomRuntime>, 'decoders'>,
  instance: Instance
) {
  const planned = planDecode(decoding.decoders, instance, Float64Array);
  if ('error' in planned) throw planned.error;
  return planned.units[0];
}

export const sourceOf = (input: URL | File) =>
  input instanceof File
    ? fromBlob(input)
    : fromUrl(input, { fetch: runtime.fetch });

export function report(name: string, value: string) {
  const output = document.createElement('output');
  output.id = name;
  output.textContent = value;
  document.querySelector('main')!.append(output);
}

export function failed(error: unknown) {
  report('error', error instanceof Error ? error.message : String(error));
}

window.addEventListener(
  'pagehide',
  () => runtimes.forEach((owned) => owned.dispose()),
  { once: true }
);
