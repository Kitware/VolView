import {
  createDicomLoader,
  getDatasetTag,
  readInstanceFacts,
  type Chunk,
} from '@volview/dicom/core';
import { fixtureBytes } from './fixtureData';

export const loader = createDicomLoader({
  assets: {
    pipelineWorkerUrl: new URL(
      './assets/itk-wasm-pipeline.min.worker.js',
      document.baseURI
    ).href,
    imageIOUrl: new URL('./assets/image-io', document.baseURI).href,
  },
});

export function report(name: string, value: string) {
  const output = document.createElement('output');
  output.id = name;
  output.textContent = value;
  document.querySelector('main')!.append(output);
}

export async function loadChunk() {
  const source =
    new URL(location.href).searchParams.get('source') === 'http'
      ? new URL('./fixture.dcm', document.baseURI)
      : new File([fixtureBytes() as Uint8Array<ArrayBuffer>], 'fixture.dcm');
  const chunk = loader.createChunk(source);
  await chunk.loadMeta();
  return chunk;
}

export function describeMetadata(chunk: Chunk) {
  const metadata = chunk.metadata!;
  const facts = readInstanceFacts(metadata);
  report('patient', getDatasetTag(metadata, '00100010')!.trim());
  report('position', facts.position!.join(', '));
  report('pixel-spacing', facts.pixelSpacing!.join(', '));
}

export function failed(error: unknown) {
  report('error', error instanceof Error ? error.message : String(error));
}

window.addEventListener('pagehide', () => loader.dispose(), { once: true });
