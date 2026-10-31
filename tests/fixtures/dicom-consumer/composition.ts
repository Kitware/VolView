import {
  createDicomCollectionRegistry,
  getChunkTag,
  type Chunk,
} from '@volview/dicom/core';
import type { VtkDicomImage } from '@volview/dicom/vtk';
import corpus from '../../dicomCompositionCorpus.json';
import { loader, failed, report } from './shared';
import { loadCollection } from './loadVolume';
import { describeVolume } from './describeVolume';

const registry = createDicomCollectionRegistry();
const images = new Map<string, VtkDicomImage>();
const params = new URL(location.href).searchParams;
const selected = corpus.cases.find(({ id }) => id === params.get('case'))!;
const incremental = params.get('mode') === 'incremental';

const append = (parent: HTMLElement, name: string, value: string) => {
  const output = document.createElement('output');
  output.dataset.field = name;
  output.textContent = value;
  parent.append(output);
};

async function createChunk(name: string) {
  const url = new URL(
    `./corpus-data/${encodeURIComponent(name)}`,
    document.baseURI
  );
  const source =
    params.get('source') === 'file'
      ? new File([await (await fetch(url)).blob()], name)
      : url;
  const chunk = loader.createChunk(source);
  await chunk.loadMeta();
  return chunk;
}

async function render(status: string) {
  document.querySelector('main')!.replaceChildren();
  for (const image of images.values()) {
    const section = document.createElement('section');
    section.className = 'volume';
    const members = image
      .getChunks()
      .map((chunk) => getChunkTag(chunk, '00080018')!.trim());
    section.dataset.firstSop = members[0];
    append(section, 'members', members.join(', '));
    await describeVolume(image, (name, value) => append(section, name, value));
    document.querySelector('main')!.append(section);
  }
  report('status', status);
}

async function register(chunks: Chunk[], status: string) {
  const { updates, removed } = await registry.register(chunks);
  for (const id of removed) {
    images.get(id)?.dispose();
    images.delete(id);
  }
  for (const update of updates) {
    images.set(update.id, await loadCollection(update, images.get(update.id)));
  }
  await render(status);
}

async function run() {
  // Interleave acquisitions/series and reverse their spatial order so neither
  // input order nor adjacent file names can stand in for physical ordering.
  const names = selected.volumes[0].files
    .flatMap((_, index) =>
      selected.volumes.flatMap(({ files }) =>
        files[index] ? [files[index]] : []
      )
    )
    .reverse();
  const chunks = await Promise.all(names.map(createChunk));
  const initial = chunks.filter((_, inputIndex) =>
    selected.volumes.some(({ files }) => {
      const spatialIndex = files.indexOf(names[inputIndex]);
      return spatialIndex >= 0 && spatialIndex % 2 === 0;
    })
  );
  if (!incremental) {
    await register(chunks, 'complete');
    return;
  }
  await register(initial, 'partial');
  const button = document.querySelector<HTMLButtonElement>('#complete-import')!;
  button.disabled = false;
  button.addEventListener(
    'click',
    () => {
      button.disabled = true;
      document.querySelector('#status')!.textContent = 'loading';
      const remaining = chunks.filter((chunk) => !initial.includes(chunk));
      register([...remaining, initial[0], initial[1]], 'complete').catch(
        failed
      );
    },
    { once: true }
  );
}

window.addEventListener(
  'pagehide',
  () => {
    images.forEach((image) => image.dispose());
    loader.dispose();
  },
  { once: true }
);

run().catch(failed);
