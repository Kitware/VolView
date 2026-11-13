import { Tags, type Instance } from '@/packages/dicom/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';

import type {
  DicomInstanceSource,
  DataSource,
} from '@/src/io/import/dataSource';
import { uriToDataSource } from '@/src/io/import/dataSource';
import {
  importDicomInstanceSources,
  PartialDicomImportError,
} from '@/src/io/import/importDataSources';
import { useDatasetStore } from '@/src/store/datasets';
import { useImageCacheStore } from '@/src/store/image-cache';
import { untilLoaded } from '@/src/composables/untilLoaded';
import {
  useDICOMStore,
  getDisplayName,
  type ImportInstancesResult,
} from '@/src/store/datasets-dicom';
import { tilt } from '@/tests/dicomOrientationFixtures';
import {
  ALLOCATION_FAILURE,
  cineFor,
  imageFactory,
  membersOf,
  OTHER_SERIES_UID,
  SERIES_UID,
  sliceFor,
  sopOf,
  STUDY_UID,
  unallocatableFor,
} from '@/src/store/__tests__/dicomImportFixtures';

const onlyId = ({ volumes }: ImportInstancesResult) => {
  const ids = Object.keys(volumes);
  expect(ids).toHaveLength(1);
  return ids[0];
};

/** The error a call throws, or null when it returns. */
const failureOf = (run: () => unknown) => {
  try {
    run();
    return null;
  } catch (error) {
    return error;
  }
};

/**
 * Orientation agreement is a tolerance, so a bucket depends on which instance
 * the walk meets first. `one` and `three` agree with each other and plan as a
 * single collection; once `zero` and `two` arrive the walk starts from `zero`,
 * and the pair splits into {zero, one} and {two, three}. Neither half holds a
 * plurality of the committed collection, so both mint fresh IDs and the
 * committed ID dissolves.
 */
const splitting = () => ({
  zero: sliceFor({ sop: 'sop-0', z: 0, orientation: tilt(0) }),
  one: sliceFor({ sop: 'sop-1', z: 1, orientation: tilt(0.013) }),
  two: sliceFor({ sop: 'sop-2', z: 2, orientation: tilt(0.039) }),
  three: sliceFor({ sop: 'sop-3', z: 3, orientation: tilt(0.026) }),
});

const cachedIds = () => Object.keys(useImageCacheStore().imageById);

/** Loads the pair a later batch splits into two fresh collections. */
const loadSplittablePair = () => {
  const instances = splitting();
  const loaded = imageFactory();
  const store = useDICOMStore();
  const id = onlyId(
    store.importInstances([instances.one, instances.three], {
      createImage: loaded.createImage,
    })
  );
  return { ...instances, store, loaded, id };
};

/** Loads and decodes one slice, then fails a batch that grows it and adds a scout. */
const growAndFail = async () => {
  const { created, createImage } = imageFactory();
  const store = useDICOMStore();
  const first = sliceFor({ sop: 'a', z: 0 });
  const id = onlyId(store.importInstances([first], { createImage }));
  await untilLoaded(id);
  const shown = created[0].getVtkImageData();

  expect(() =>
    store.importInstances(
      [sliceFor({ sop: 'b', z: 1 }), unallocatableFor({ sop: 'scout' })],
      { createImage }
    )
  ).toThrow(ALLOCATION_FAILURE);

  return { store, id, first, created, shown };
};

describe('DICOM store atomic series commit', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('commits nothing for a series when one of its collections fails to allocate', () => {
    const { created, createImage } = imageFactory();
    const store = useDICOMStore();

    expect(() =>
      store.importInstances(
        [
          unallocatableFor({ sop: 'scout' }),
          sliceFor({ sop: 'a', z: 0 }),
          sliceFor({ sop: 'b', z: 1 }),
        ],
        { createImage }
      )
    ).toThrow(ALLOCATION_FAILURE);

    expect(created).toEqual([]);
    expect(cachedIds()).toEqual([]);
    expect(store.volumeInfo).toEqual({});
    expect(store.volumeStudy).toEqual({});
    expect(store.studyVolumes).toEqual({});
    expect(store.studyInfo).toEqual({});
    expect(store.patientInfo).toEqual({});
    expect(store.patientStudies).toEqual({});
  });

  it('leaves a displayed volume and its pixels unchanged when its growth fails', async () => {
    const { store, id, first, created, shown } = await growAndFail();

    expect(created).toHaveLength(1);
    expect(created[0].getInstances()).toEqual([first]);
    expect(created[0].getVtkImageData()).toBe(shown);
    expect(shown.isDeleted()).toBe(false);
    expect(Array.from(shown.getPointData().getScalars().getData())).toEqual(
      Array(16).fill(1)
    );
    expect(cachedIds()).toEqual([id]);
    expect(store.volumeInfo[id].NumberOfSlices).toBe(1);
    expect(store.studyVolumes[STUDY_UID]).toEqual([id]);
  });

  it('lets the next import of the series commit after a failed batch', async () => {
    const { store, id, first, created } = await growAndFail();

    const retry = imageFactory();
    const corrected = sliceFor({ sop: 'b', z: 1 });
    const scout = sliceFor({ sop: 'scout', rows: '8' });
    const result = store.importInstances([corrected, scout], {
      createImage: retry.createImage,
    });

    // The unchanged key keeps its ID, and only the scout needs a new image.
    const ids = Object.keys(result.volumes);
    expect(ids).toHaveLength(2);
    expect(ids).toContain(id);
    expect(retry.created).toHaveLength(1);

    const scoutId = ids.find((other) => other !== id)!;
    // Identity, not shape: the failed batch must not pin the instance it brought.
    expect(result.volumes[id]).toEqual([first, corrected]);
    expect(result.volumes[id][1]).toBe(corrected);
    expect(result.volumes[scoutId]).toEqual([scout]);
    expect(created[0].getInstances()[1]).toBe(corrected);
    expect(store.volumeInfo[id].NumberOfSlices).toBe(2);
    expect(store.volumeInfo[scoutId].NumberOfSlices).toBe(1);
  });

  it('keeps a dissolved volume when the split that dissolves it fails', () => {
    const { store, id, zero, two, loaded } = loadSplittablePair();

    const failing = imageFactory();
    expect(() =>
      store.importInstances([zero, two, unallocatableFor({ sop: 'scout' })], {
        createImage: failing.createImage,
      })
    ).toThrow(ALLOCATION_FAILURE);

    expect(cachedIds()).toEqual([id]);
    expect(store.volumeInfo[id].NumberOfSlices).toBe(2);
    expect(store.studyVolumes[STUDY_UID]).toEqual([id]);
    expect(membersOf(loaded.created[0])).toEqual(['sop-1', 'sop-3']);
    expect(failing.created).toEqual([]);
  });

  it('hands a dissolved volume to the given removal', () => {
    const { store, id, zero, two } = loadSplittablePair();
    const removed: string[] = [];

    const result = store.importInstances([zero, two], {
      createImage: imageFactory().createImage,
      removeDissolved: (dissolved) => removed.push(dissolved),
    });

    expect(removed).toEqual([id]);
    expect(result.dissolved).toEqual([id]);
    // The removal is the caller's whole, so the store evicted nothing itself.
    expect(cachedIds()).toContain(id);
    expect(store.volumeInfo[id]).toBeDefined();
  });

  it('removes the dissolved volume once the split commits', () => {
    const { store, id, zero, one, two, three } = loadSplittablePair();

    const result = store.importInstances([zero, two], {
      createImage: imageFactory().createImage,
    });

    expect(result.dissolved).toEqual([id]);
    const ids = Object.keys(result.volumes);
    expect(ids).toHaveLength(2);
    expect(ids).not.toContain(id);
    expect(store.volumeInfo[id]).toBeUndefined();
    expect(cachedIds().sort()).toEqual([...ids].sort());
    expect(store.studyVolumes[STUDY_UID].sort()).toEqual([...ids].sort());
    expect(ids.map((each) => store.volumeInfo[each].NumberOfSlices)).toEqual([
      2, 2,
    ]);
    // Each half carries the provenance of the member it inherited.
    expect(Object.values(result.volumes)).toContainEqual([zero, one]);
    expect(Object.values(result.volumes)).toContainEqual([two, three]);
  });

  it('converges on the one-shot plan when one series arrives in two imports', () => {
    const state = (created: ReturnType<typeof imageFactory>['created']) => {
      const store = useDICOMStore();
      return {
        volumes: Object.fromEntries(
          Object.entries(store.volumeInfo).map(([id, info]) => [
            id,
            info.NumberOfSlices,
          ])
        ),
        members: created.map(membersOf),
      };
    };

    const oneShot = () => {
      setActivePinia(createPinia());
      const { created, createImage } = imageFactory();
      useDICOMStore().importInstances(
        [sliceFor({ sop: 'a', z: 0 }), sliceFor({ sop: 'b', z: 1 })],
        { createImage }
      );
      return state(created);
    };

    const twice = () => {
      setActivePinia(createPinia());
      const { created, createImage } = imageFactory();
      const store = useDICOMStore();
      store.importInstances([sliceFor({ sop: 'a', z: 0 })], { createImage });
      store.importInstances([sliceFor({ sop: 'b', z: 1 })], { createImage });
      return state(created);
    };

    expect(twice()).toEqual(oneShot());
  });

  it('registers no cine image when a sibling collection fails', () => {
    const { createImage } = imageFactory();
    const store = useDICOMStore();

    expect(() =>
      store.importInstances(
        [cineFor('cine'), unallocatableFor({ sop: 'scout' })],
        { createImage }
      )
    ).toThrow(ALLOCATION_FAILURE);

    // A cine clip is planned like any other collection: it reaches no store alone.
    expect(cachedIds()).toEqual([]);
    expect(store.volumeInfo).toEqual({});
    expect(store.studyVolumes).toEqual({});
  });

  it('releases the instances of a volume the user removed', async () => {
    const store = useDICOMStore();
    let scoutRef!: WeakRef<Instance>;

    // The series keeps its other collection, so nothing that outlives the
    // import is emptied out from under the removed one.
    await (async () => {
      const scout = sliceFor({ sop: 'scout', rows: '8' });
      scoutRef = new WeakRef(scout);
      const { createImage } = imageFactory();
      const { volumes } = store.importInstances(
        [scout, sliceFor({ sop: 'a', z: 0 }), sliceFor({ sop: 'b', z: 1 })],
        { createImage }
      );
      const removed = Object.entries(volumes).find(
        ([, instances]) => instances[0] === scout
      )![0];
      await untilLoaded(removed);
      useDatasetStore().remove(removed);
    })();
    // Cache eviction disposes the image after the next flush.
    await nextTick();
    // A WeakRef keeps its target until the current job ends, deterministically.
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    const { gc } = globalThis as { gc?: () => void };
    if (!gc) throw new Error('run vitest with --expose-gc');
    gc();

    // Whatever the store and the registry still hold would pin the header.
    expect(scoutRef.deref()).toBeUndefined();
  });
});

const sourceFor = (instance: Instance) => {
  const name = `${sopOf(instance)}.dcm`;
  const source: DataSource = {
    type: 'dicom',
    instance,
    parent: uriToDataSource(`https://ex/${name}`, name, 'application/dicom'),
  };
  return source as DataSource & DicomInstanceSource;
};

const sopsOfDataset = (dataSource: DataSource | undefined) => {
  if (dataSource?.type !== 'collection') throw new Error('Expected collection');
  return dataSource.sources.map((src) => {
    if (src.type !== 'dicom') throw new Error('Expected a DICOM source');
    return sopOf(src.instance);
  });
};

/** The pipeline's own shape: committed series reach the dataset store. */
const load = (
  instances: Instance[],
  createImage = imageFactory().createImage
) =>
  importDicomInstanceSources(instances.map(sourceFor), (batch, hooks) =>
    useDICOMStore().importInstances(batch, { createImage, ...hooks })
  );

describe('importDicomInstanceSources atomic series commit', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('leaves the dataset list and its provenance unchanged when a commit fails', () => {
    const { zero, one, two, three } = splitting();
    const store = useDICOMStore();
    const datasetStore = useDatasetStore();

    const [loadable] = load([one, three]);
    const id = loadable.dataID;
    expect(sopsOfDataset(datasetStore.getDataSource(id))).toEqual([
      'sop-1',
      'sop-3',
    ]);

    expect(() => load([zero, two, unallocatableFor({ sop: 'scout' })])).toThrow(
      ALLOCATION_FAILURE
    );

    expect(datasetStore.idsAsSelections).toEqual([id]);
    expect(sopsOfDataset(datasetStore.getDataSource(id))).toEqual([
      'sop-1',
      'sop-3',
    ]);
    expect(cachedIds()).toEqual([id]);
    expect(store.volumeInfo[id].NumberOfSlices).toBe(2);
  });

  it('grows a volume after the user removed its sibling', () => {
    const store = useDICOMStore();
    const datasetStore = useDatasetStore();

    const loaded = load([
      sliceFor({ sop: 'scout', rows: '8' }),
      sliceFor({ sop: 'a', z: 0 }),
      sliceFor({ sop: 'b', z: 1 }),
    ]);
    const idOf = (sops: string[]) =>
      loaded.find(
        ({ dataID }) =>
          sopsOfDataset(datasetStore.getDataSource(dataID)).join() ===
          sops.join()
      )!.dataID;
    const scoutId = idOf(['scout']);
    const id = idOf(['a', 'b']);

    datasetStore.remove(scoutId);
    load([sliceFor({ sop: 'c', z: 2 })]);

    expect(sopsOfDataset(datasetStore.getDataSource(id))).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(store.volumeInfo[id].NumberOfSlices).toBe(3);
    expect(datasetStore.getDataSource(scoutId)).toBeUndefined();
    expect(store.volumeInfo[scoutId]).toBeUndefined();
  });

  it('reports what a committed series landed and blames only what failed', () => {
    const { zero, one, two, three } = splitting();
    const store = useDICOMStore();
    const datasetStore = useDatasetStore();

    const [loadable] = load([one, three]);
    const dissolvedId = loadable.dataID;

    const failure = failureOf(() =>
      load([
        zero,
        two,
        unallocatableFor({ sop: 'other', series: OTHER_SERIES_UID }),
      ])
    );

    expect(failure).toBeInstanceOf(PartialDicomImportError);
    expect((failure as Error).message).toMatch(ALLOCATION_FAILURE);

    // A committed series must not be reported as loaded and failed at once.
    expect(
      (failure as PartialDicomImportError).failures.flatMap(({ sources }) =>
        sources.map((src) => sopOf(src.instance))
      )
    ).toEqual(['other']);

    // The committed series dissolved this collection, so its dataset goes with it.
    const landed = (failure as PartialDicomImportError).loadables;
    const ids = landed.map(({ dataID }) => dataID);
    expect(ids).toHaveLength(2);
    expect(datasetStore.idsAsSelections.sort()).toEqual([...ids].sort());
    expect(store.volumeInfo[dissolvedId]).toBeUndefined();
    expect(
      ids.map((id) => sopsOfDataset(datasetStore.getDataSource(id)))
    ).toContainEqual(['sop-0', 'sop-1']);
  });
});

describe('DICOM record naming', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('commits a nameless series with a usable fallback name', () => {
    const nameless = sliceFor({
      sop: 'nameless',
      tags: { [Tags.SeriesNumber]: '', [Tags.SeriesDescription]: '' },
    });
    const store = useDICOMStore();
    const { created, createImage } = imageFactory();
    const id = onlyId(store.importInstances([nameless], { createImage }));
    expect(created[0].getName()).toBe(SERIES_UID);
    expect(getDisplayName(store.volumeInfo[id])).toBe(SERIES_UID);
  });
});
