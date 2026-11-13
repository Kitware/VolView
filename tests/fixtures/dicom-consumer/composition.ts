import {
  emptyRegistry,
  registerInstances,
} from '@volview/dicom/core/collections/instanceRegistry';
import { getDatasetTag } from '@volview/dicom/core/metadata/datasetAccess';
import type { Instance } from '@volview/dicom/core/instance/readInstance';
import corpus from '../../dicomCompositionCorpus.json';
import { failed, never, report, runtime, sourceOf } from './shared';
import { loadCollection } from './loadVolume';
import { describeVolume } from './describeVolume';

let registry = emptyRegistry;
const loaded = new Map<string, Awaited<ReturnType<typeof loadCollection>>>();
const params = new URL(location.href).searchParams;
const selected = corpus.cases.find(({ id }) => id === params.get('case'))!;
const incremental = params.get('mode') === 'incremental';

const append = (parent: HTMLElement, name: string, value: string) => {
  const output = document.createElement('output');
  output.dataset.field = name;
  output.textContent = value;
  parent.append(output);
};

async function readFixture(name: string) {
  const url = new URL(
    `./corpus-data/${encodeURIComponent(name)}`,
    document.baseURI
  );
  const input =
    params.get('source') === 'file'
      ? new File([await (await fetch(url)).blob()], name)
      : url;
  return runtime.readInstance(sourceOf(input), never);
}

async function render(status: string) {
  document.querySelector('main')!.replaceChildren();
  for (const { volume, image } of loaded.values()) {
    const section = document.createElement('section');
    section.className = 'volume';
    const members = volume.members.map(({ dataset }) =>
      getDatasetTag(dataset, '00080018')!.trim()
    );
    section.dataset.firstSop = members[0];
    append(section, 'members', members.join(', '));
    await describeVolume(image, (name, value) => append(section, name, value));
    document.querySelector('main')!.append(section);
  }
  report('status', status);
}

async function register(instances: Instance[], status: string) {
  const { state, updates, removed } = registerInstances(registry, instances);
  registry = state;
  removed.forEach((id) => {
    loaded.get(id)?.image.delete();
    loaded.delete(id);
  });
  for (const update of updates) {
    const previous = loaded.get(update.id);
    loaded.set(
      update.id,
      await loadCollection(update, { previous: previous?.volume })
    );
    previous?.image.delete();
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
  const instances = await Promise.all(names.map(readFixture));
  const initial = instances.filter((_, inputIndex) =>
    selected.volumes.some(({ files }) => {
      const spatialIndex = files.indexOf(names[inputIndex]);
      return spatialIndex >= 0 && spatialIndex % 2 === 0;
    })
  );
  if (!incremental) {
    await register(instances, 'complete');
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
      const remaining = instances.filter(
        (instance) => !initial.includes(instance)
      );
      register([...remaining, initial[0], initial[1]], 'complete').catch(
        failed
      );
    },
    { once: true }
  );
}

window.addEventListener(
  'pagehide',
  () => loaded.forEach(({ image }) => image.delete()),
  { once: true }
);

run().catch(failed);
