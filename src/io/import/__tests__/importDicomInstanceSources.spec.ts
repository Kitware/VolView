import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { Instance } from '@/src/dicom/core/instance/readInstance';
import {
  buildStateIDToStoreID,
  importDicomInstanceSources,
} from '@/src/io/import/importDataSources';
import type { DicomInstanceSource } from '@/src/io/import/dataSource';
import { useDICOMStore } from '@/src/store/datasets-dicom';
import { useDatasetStore } from '@/src/store/datasets';
import { useImageCacheStore } from '@/src/store/image-cache';
import {
  acquisition,
  ALLOCATION_FAILURE,
  imageFactory,
  OTHER_SERIES_UID,
  sliceFor,
  sopOf,
  sopsOfDataset,
  sourceFor,
  splitting,
  unallocatableFor,
} from '@/src/store/__tests__/dicomImportFixtures';

beforeEach(() => setActivePinia(createPinia()));

/** A source tied to a saved dataset, as a session restore supplies it. */
const restored = (instance: Instance, stateID: string) => ({
  ...sourceFor(instance),
  stateFileLeaf: { stateID },
});

const idsOf = (loadables: { dataID: string }[]) =>
  loadables.map(({ dataID }) => dataID);

describe('importDicomInstanceSources with a given commit', () => {
  const sources = (...sops: string[]) =>
    sops.map((sop) => sourceFor(sliceFor({ sop })));

  it('returns a stable order regardless of series commit order', () => {
    const [a, b] = sources('a', 'b');
    const { loadables } = importDicomInstanceSources([a, b], () => ({
      volumes: { b: [b.instance], a: [a.instance] },
      failures: [],
    }));
    expect(idsOf(loadables)).toEqual(['a', 'b']);
  });

  it('maps only leaves supplied by this restore while saving full membership', () => {
    const previous = restored(sliceFor({ sop: 'previous' }), '1');
    importDicomInstanceSources([previous], (instances) => ({
      volumes: { existing: instances },
      failures: [],
    }));
    const current = restored(sliceFor({ sop: 'current' }), '2');
    const other = restored(sliceFor({ sop: 'other' }), '1');
    const { loadables } = importDicomInstanceSources([current, other], () => ({
      volumes: {
        existing: [previous.instance, current.instance],
        other: [other.instance],
      },
      failures: [],
    }));
    expect(buildStateIDToStoreID(loadables)).toEqual({
      1: 'other',
      2: 'existing',
    });
    expect(sopsOfDataset(useDatasetStore().getDataSource('existing'))).toEqual([
      'previous',
      'current',
    ]);
  });

  // A dissolved id is removed during the commit, as the store does it.
  it('inherits a moved member and drops the dissolved dataset', () => {
    const datasetStore = useDatasetStore();
    const [a, b, c] = sources('sop-a', 'sop-b', 'sop-c');
    const load = (
      supplied: DicomInstanceSource[],
      volumes: Record<string, Instance[]>,
      dissolved: string[] = []
    ) =>
      importDicomInstanceSources(
        supplied,
        (_instances, { removeDissolved }) => {
          dissolved.forEach(removeDissolved);
          return { volumes, failures: [] };
        }
      );

    load([a, b], { 'vol-1': [a.instance], 'vol-2': [b.instance] });
    expect(datasetStore.getDataSource('vol-2')).toBeDefined();

    load([c], { 'vol-1': [a.instance, b.instance, c.instance] }, ['vol-2']);

    expect(datasetStore.getDataSource('vol-2')).toBeUndefined();
    expect(sopsOfDataset(datasetStore.getDataSource('vol-1'))).toEqual([
      'sop-a',
      'sop-b',
      'sop-c',
    ]);
  });
});

describe('importDicomInstanceSources through the DICOM store', () => {
  const loadSources = (sources: DicomInstanceSource[]) => {
    const { createImage } = imageFactory();
    return importDicomInstanceSources(sources, (batch, hooks) =>
      useDICOMStore().importInstances(batch, { createImage, ...hooks })
    );
  };
  const load = (instances: Instance[]) => loadSources(instances.map(sourceFor));

  const failedSops = ({ failures }: ReturnType<typeof load>) =>
    failures.map(({ error, sources }) => [
      error.message,
      sources.map(({ instance }) => sopOf(instance)),
    ]);

  it('blames each rejected series on its own sources', () => {
    const result = load([
      unallocatableFor({ sop: 'first' }),
      unallocatableFor({ sop: 'second', series: OTHER_SERIES_UID }),
    ]);

    expect(result.loadables).toEqual([]);
    expect(failedSops(result)).toEqual([
      [expect.stringMatching(ALLOCATION_FAILURE), ['first']],
      [expect.stringMatching(ALLOCATION_FAILURE), ['second']],
    ]);
  });

  it('leaves the dataset list and its provenance unchanged when a commit fails', () => {
    const { zero, one, two, three } = splitting();
    const datasetStore = useDatasetStore();
    const [id] = idsOf(load([one, three]).loadables);

    const result = load([zero, two, unallocatableFor({ sop: 'scout' })]);

    expect(result.loadables).toEqual([]);
    expect(failedSops(result)).toEqual([
      [expect.stringMatching(ALLOCATION_FAILURE), ['sop-0', 'sop-2', 'scout']],
    ]);
    expect(datasetStore.idsAsSelections).toEqual([id]);
    expect(sopsOfDataset(datasetStore.getDataSource(id))).toEqual([
      'sop-1',
      'sop-3',
    ]);
    expect(Object.keys(useImageCacheStore().imageById)).toEqual([id]);
  });

  it('reports what a committed series landed beside the one that failed', () => {
    const { zero, one, two, three } = splitting();
    const datasetStore = useDatasetStore();
    const [dissolvedId] = idsOf(load([one, three]).loadables);

    const result = load([
      zero,
      two,
      unallocatableFor({ sop: 'other', series: OTHER_SERIES_UID }),
    ]);

    // A committed series must not be reported as loaded and failed at once.
    expect(failedSops(result)).toEqual([
      [expect.stringMatching(ALLOCATION_FAILURE), ['other']],
    ]);
    // The committed series dissolved this collection, so its dataset went.
    const ids = idsOf(result.loadables);
    expect(ids).toHaveLength(2);
    expect(ids).not.toContain(dissolvedId);
    expect([...datasetStore.idsAsSelections].sort()).toEqual([...ids].sort());
    expect(
      ids.map((id) => sopsOfDataset(datasetStore.getDataSource(id)))
    ).toContainEqual(['sop-0', 'sop-1']);
  });

  it('grows a volume after the user removed its sibling', () => {
    const datasetStore = useDatasetStore();
    const loaded = idsOf(
      load([
        sliceFor({ sop: 'scout', rows: '8' }),
        sliceFor({ sop: 'a', z: 0 }),
        sliceFor({ sop: 'b', z: 1 }),
      ]).loadables
    );
    const idOf = (sops: string[]) =>
      loaded.find(
        (id) =>
          sopsOfDataset(datasetStore.getDataSource(id)).join() === sops.join()
      )!;
    const scoutId = idOf(['scout']);
    const id = idOf(['a', 'b']);

    datasetStore.remove(scoutId);
    load([sliceFor({ sop: 'c', z: 2 })]);

    expect(sopsOfDataset(datasetStore.getDataSource(id))).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(datasetStore.idsAsSelections).toEqual([id]);
  });

  it('repartitions saved provenance when a later import splits the series', () => {
    const datasetStore = useDatasetStore();
    const first = acquisition('1', [0, 2.5, 5]);
    const second = acquisition('2', [0.75, 3.25, 5.75]);

    const [firstId] = idsOf(load(first).loadables);
    // The first pass is relabelled, which is not a volume this import loaded.
    const [secondId, ...others] = idsOf(load(second).loadables);

    expect(others).toEqual([]);
    expect(secondId).not.toBe(firstId);
    // Each dataset saves exactly its own pass, so a restore replans them the
    // same way and binds saved state to the right volume.
    expect(sopsOfDataset(datasetStore.getDataSource(firstId))).toEqual(
      first.map(sopOf)
    );
    expect(sopsOfDataset(datasetStore.getDataSource(secondId))).toEqual(
      second.map(sopOf)
    );
  });

  it('binds both saved volumes to the one they now restore as', () => {
    // Without the first pass's last slice the passes no longer overlap.
    const first = acquisition('1', [0, 2.5]);
    const second = acquisition('2', [4, 6.5, 9]);

    const { loadables } = loadSources([
      ...first.map((instance) => restored(instance, 'pass-1')),
      ...second.map((instance) => restored(instance, 'pass-2')),
    ]);

    const [mergedId] = idsOf(loadables);
    expect(buildStateIDToStoreID(loadables)).toEqual({
      'pass-1': mergedId,
      'pass-2': mergedId,
    });
  });
});
