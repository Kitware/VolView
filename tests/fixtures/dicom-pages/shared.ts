import {
  createDicomRuntime,
  fromBlob,
  fromUrl,
  getDatasetTag,
  planDecode,
  singleDecoderTable,
  type DicomRuntimeOptions,
  type Instance,
} from '@/packages/dicom/core';
import { fixtureBytes } from './fixtureData';

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

export async function loadInstance() {
  const input =
    new URL(location.href).searchParams.get('source') === 'http'
      ? new URL('./fixture.dcm', document.baseURI)
      : new File([fixtureBytes() as Uint8Array<ArrayBuffer>], 'fixture.dcm');
  return runtime.readInstance(sourceOf(input), never);
}

export function describeMetadata({ dataset }: Instance) {
  const numbers = (tag: string) =>
    getDatasetTag(dataset, tag)!.split('\\').map(Number).join(', ');
  report('patient', getDatasetTag(dataset, '00100010')!.trim());
  report('position', numbers('00200032'));
  report('pixel-spacing', numbers('00280030'));
}

export function failed(error: unknown) {
  report('error', error instanceof Error ? error.message : String(error));
}

window.addEventListener(
  'pagehide',
  () => runtimes.forEach((owned) => owned.dispose()),
  { once: true }
);
