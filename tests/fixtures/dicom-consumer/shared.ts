import {
  createDicomRuntime,
  type DicomRuntimeOptions,
} from '@volview/dicom/core/runtime/createDicomRuntime';
import { fromBlob, fromUrl } from '@volview/dicom/core/source/byteSource';
import type { Instance } from '@volview/dicom/core/instance/readInstance';
import { getDatasetTag } from '@volview/dicom/core/metadata/datasetAccess';
import { readInstanceFacts } from '@volview/dicom/core/collections/instanceFacts';
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
  const facts = readInstanceFacts(dataset);
  report('patient', getDatasetTag(dataset, '00100010')!.trim());
  report('position', facts.position!.join(', '));
  report('pixel-spacing', facts.pixelSpacing!.join(', '));
}

export function failed(error: unknown) {
  report('error', error instanceof Error ? error.message : String(error));
}

window.addEventListener(
  'pagehide',
  () => runtimes.forEach((owned) => owned.dispose()),
  { once: true }
);
