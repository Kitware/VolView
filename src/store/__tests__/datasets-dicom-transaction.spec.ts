import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import type { Chunk } from '@/src/core/streaming/chunk';
import { FILE_EXT_TO_MIME } from '@/src/io/mimeTypes';
import type { ChunkSource, DataSource } from '@/src/io/import/dataSource';
import { uriToDataSource } from '@/src/io/import/dataSource';
import {
  importDicomChunkSources,
  PartialDicomImportError,
} from '@/src/io/import/importDataSources';
import { useDatasetStore } from '@/src/store/datasets';
import { useImageCacheStore } from '@/src/store/image-cache';
import {
  useDICOMStore,
  type ImportChunksResult,
} from '@/src/store/datasets-dicom';
import { tilt } from '@/src/core/dicom/__tests__/orientationFixtures';
import {
  cineHeader,
  cineParseResult,
} from '@/src/core/cine/__tests__/cineFixtures';
import {
  chunkFor,
  cineChunkFor,
  flush,
  imageFactory,
  sopOf,
  OTHER_SERIES_UID,
  SERIES_UID,
  STUDY_UID,
  type FakeChunkImage,
} from '@/src/store/__tests__/dicomImportFixtures';

const BUFFER_FAILURE = 'cannot allocate the volume buffer';

const never = () => new Promise<void>(() => {});

const failsAt = (failing: number) => (index: number) =>
  index === failing
    ? Promise.reject(new Error(BUFFER_FAILURE))
    : Promise.resolve();

const onlyId = ({ volumes }: ImportChunksResult) => {
  const ids = Object.keys(volumes);
  expect(ids).toHaveLength(1);
  return ids[0];
};

// A scout of a different size never shares a collection with the slices, so
// one batch of one series carries two collections.
const scoutBatch = () => ({
  scout: chunkFor({ sop: 'scout', rows: '8', z: 0 }),
  slices: [chunkFor({ sop: 'a', z: 0 }), chunkFor({ sop: 'b', z: 1 })],
});

/**
 * Orientation agreement is a tolerance, so a bucket depends on which instance
 * the walk meets first. `one` and `three` agree with each other and plan as a
 * single collection; once `zero` and `two` arrive the walk starts from `zero`,
 * and the pair splits into {zero, one} and {two, three}. Neither half holds a
 * plurality of the committed collection, so both mint fresh IDs and the
 * committed ID dissolves.
 */
const splitting = () => ({
  zero: chunkFor({ sop: 'sop-0', z: 0, orientation: tilt(0) }),
  one: chunkFor({ sop: 'sop-1', z: 1, orientation: tilt(0.013) }),
  two: chunkFor({ sop: 'sop-2', z: 2, orientation: tilt(0.039) }),
  three: chunkFor({ sop: 'sop-3', z: 3, orientation: tilt(0.026) }),
});

const cachedIds = () => Object.keys(useImageCacheStore().imageById);

// `vite.config.ts` runs the suite with --expose-gc, so an unreachable object is
// collected rather than merely eligible.
const collect = async (rounds = 5): Promise<void> => {
  const { gc } = globalThis as { gc?: () => void };
  if (!gc) throw new Error('run vitest with --expose-gc');
  await flush();
  gc();
  if (rounds > 1) await collect(rounds - 1);
};

// The same image is asked twice: once for the first slice, once for the
// membership the second slice grows it to.
const failsFirstGrowth = () => {
  let failed = false;
  return (_index: number, chunks: Chunk[]) => {
    if (chunks.length === 1 || failed) return Promise.resolve();
    failed = true;
    return Promise.reject(new Error(BUFFER_FAILURE));
  };
};

/** Loads one slice of a series and readies a second for the next batch. */
const loadOneSlice = async (hooks: Parameters<typeof imageFactory>[0]) => {
  const { created, createChunkImage } = imageFactory(hooks);
  const store = useDICOMStore();
  const first = chunkFor({ sop: 'a', z: 0 });
  const second = chunkFor({ sop: 'b', z: 1 });

  const id = onlyId(await store.importChunks([first], { createChunkImage }));
  return { store, id, first, second, created, createChunkImage };
};

/** Loads one slice, then fails the batch that grows the volume with a second. */
const failGrowth = async () => {
  const loaded = await loadOneSlice({ onPrepare: failsFirstGrowth() });
  const { store, second, createChunkImage } = loaded;
  await expect(
    store.importChunks([second], { createChunkImage })
  ).rejects.toThrow(/buffer/);
  await flush();

  return loaded;
};

/** Loads one slice, then fails a batch that grows it and adds a scout. */
const growAndFail = async () => {
  const { created, createChunkImage } = imageFactory({ onPrepare: failsAt(1) });
  const store = useDICOMStore();
  const first = chunkFor({ sop: 'a', z: 0 });
  const second = chunkFor({ sop: 'b', z: 1 });
  const scout = chunkFor({ sop: 'scout', rows: '8', z: 0 });

  const id = onlyId(await store.importChunks([first], { createChunkImage }));
  await expect(
    store.importChunks([second, scout], { createChunkImage })
  ).rejects.toThrow(/buffer/);

  return { store, id, first, second, scout, created };
};

/** Loads the pair a later batch splits into two fresh collections. */
const loadSplittablePair = async () => {
  const chunks = splitting();
  const loaded = imageFactory();
  const store = useDICOMStore();
  const id = onlyId(
    await store.importChunks([chunks.one, chunks.three], {
      createChunkImage: loaded.createChunkImage,
    })
  );
  return { ...chunks, store, loaded, id };
};

describe('DICOM store transactional commit', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('registers nothing while a candidate for the series is still preparing', async () => {
    const { createChunkImage } = imageFactory({
      onPrepare: (index) => (index === 1 ? never() : Promise.resolve()),
    });
    const store = useDICOMStore();
    const { scout, slices } = scoutBatch();

    store
      .importChunks([scout, ...slices], { createChunkImage })
      .catch(() => {});
    await flush();

    // The prepared candidate stays off-store until every candidate exists.
    expect(cachedIds()).toEqual([]);
    expect(store.volumeInfo).toEqual({});
    expect(store.studyVolumes).toEqual({});
    expect(store.patientInfo).toEqual({});
  });

  it('commits every collection of a batch in one synchronous step', async () => {
    const store = useDICOMStore();
    const imageCacheStore = useImageCacheStore();
    const seen: Array<[number, number]> = [];
    // Probes the stores from the first microtask after a registration. A commit
    // that awaits between its mutations lets the probe run half way through.
    const { createChunkImage } = imageFactory({
      onPrepare: (index) =>
        index === 1
          ? new Promise<void>((resolve) => {
              setTimeout(resolve, 0);
            })
          : Promise.resolve(),
      onStartLoad: () =>
        queueMicrotask(() =>
          seen.push([
            Object.keys(imageCacheStore.imageById).length,
            Object.keys(store.volumeInfo).length,
          ])
        ),
    });
    const { scout, slices } = scoutBatch();

    await store.importChunks([scout, ...slices], { createChunkImage });
    await flush();

    expect(seen).toEqual([
      [2, 2],
      [2, 2],
    ]);
  });

  it('commits nothing for a series when one of its candidates fails to prepare', async () => {
    const { createChunkImage } = imageFactory({ onPrepare: failsAt(1) });
    const store = useDICOMStore();
    const { scout, slices } = scoutBatch();

    await expect(
      store.importChunks([scout, ...slices], { createChunkImage })
    ).rejects.toThrow(/buffer/);

    expect(cachedIds()).toEqual([]);
    expect(store.volumeInfo).toEqual({});
    expect(store.sliceData).toEqual({});
    expect(store.volumeStudy).toEqual({});
    expect(store.studyVolumes).toEqual({});
    expect(store.studyInfo).toEqual({});
    expect(store.patientInfo).toEqual({});
    expect(store.patientStudies).toEqual({});
  });

  it('disposes the candidates a failed batch prepared', async () => {
    const { created, createChunkImage } = imageFactory({
      onPrepare: failsAt(1),
    });
    const store = useDICOMStore();
    const { scout, slices } = scoutBatch();

    await expect(
      store.importChunks([scout, ...slices], { createChunkImage })
    ).rejects.toThrow(/buffer/);

    expect(created).toHaveLength(2);
    // An uncommitted candidate owns a volume buffer nothing else can release.
    expect(created.map((image) => image.disposeCount)).toEqual([1, 1]);
    expect(created.map((image) => image.startLoadCount)).toEqual([0, 0]);
  });

  it('leaves a loaded volume unchanged when a new candidate fails', async () => {
    const { store, id, first, created } = await growAndFail();

    const [loaded, candidate] = created;
    // Growth is undone, so a failed sibling leaves the volume as it was.
    expect(loaded.getChunks()).toEqual([first]);
    expect(loaded.startLoadCount).toBe(1);
    expect(loaded.disposeCount).toBe(0);
    expect(candidate.disposeCount).toBe(1);
    expect(cachedIds()).toEqual([id]);
    expect(store.volumeInfo[id].NumberOfSlices).toBe(1);
    expect(store.studyVolumes[STUDY_UID]).toEqual([id]);
  });

  it('lets the next import of the series commit after a failed batch', async () => {
    const { store, id, first, scout, created } = await growAndFail();

    const retry = imageFactory();
    const corrected = chunkFor({ sop: 'b', z: 1 });
    const result = await store.importChunks([corrected, scout], {
      createChunkImage: retry.createChunkImage,
    });

    // The unchanged key keeps its ID, and only the scout needs a new image.
    const ids = Object.keys(result.volumes);
    expect(ids).toHaveLength(2);
    expect(ids).toContain(id);
    expect(retry.created).toHaveLength(1);

    const scoutId = ids.find((other) => other !== id)!;
    // Identity, not shape: the failed batch must not pin the chunk it brought.
    expect(result.volumes[id]).toEqual([first, corrected]);
    expect(result.volumes[id][1]).toBe(corrected);
    expect(result.volumes[scoutId]).toEqual([scout]);
    const grown = created[0].setChunksCalls.at(-1)!;
    expect(grown).toHaveLength(2);
    expect(grown[0]).toBe(first);
    expect(grown[1]).toBe(corrected);
    expect(store.volumeInfo[id].NumberOfSlices).toBe(2);
    expect(store.volumeInfo[scoutId].NumberOfSlices).toBe(1);
  });

  it('loads a growing volume once it holds the members it gained', async () => {
    const held: number[] = [];
    const { created, createChunkImage } = imageFactory({
      onStartLoad: (index) => held.push(created[index].getChunks().length),
    });
    const store = useDICOMStore();

    await store.importChunks([chunkFor({ sop: 'a', z: 0 })], {
      createChunkImage,
    });
    await store.importChunks([chunkFor({ sop: 'b', z: 1 })], {
      createChunkImage,
    });
    await flush();

    // A load started beside the membership change would never reach the slice
    // the second import added.
    expect(created).toHaveLength(1);
    expect(held).toEqual([1, 2]);
  });

  it('keeps the volume the growth could not change', async () => {
    const { store, id, first, created } = await failGrowth();

    // The record never promises slices the image does not hold.
    expect(store.volumeInfo[id].NumberOfSlices).toBe(1);
    expect(created[0].getChunks()).toEqual([first]);
    expect(created[0].startLoadCount).toBe(1);
    expect(cachedIds()).toEqual([id]);
  });

  it('does not let a failed growth undo the import that follows it', async () => {
    // Rejects only after the next import of the series would have committed,
    // which is when a growth that outlives its transaction does its damage.
    const failsLateOnGrowth = () => {
      let failed = false;
      return (_index: number, chunks: Chunk[]) => {
        if (chunks.length !== 2 || failed) return Promise.resolve();
        failed = true;
        return flush().then(() => Promise.reject(new Error(BUFFER_FAILURE)));
      };
    };
    const { created, createChunkImage } = imageFactory({
      onPrepare: failsLateOnGrowth(),
    });
    const store = useDICOMStore();
    const first = chunkFor({ sop: 'a', z: 0 });

    const id = onlyId(await store.importChunks([first], { createChunkImage }));
    await expect(
      store.importChunks([chunkFor({ sop: 'b', z: 1 })], { createChunkImage })
    ).rejects.toThrow(/buffer/);

    const third = chunkFor({ sop: 'c', z: 2 });
    await store.importChunks([third], { createChunkImage });
    await flush();

    expect(store.volumeInfo[id].NumberOfSlices).toBe(2);
    expect(created[0].getChunks()).toEqual([first, third]);
  });

  it('lets a corrected re-import replace the chunk a failed growth brought', async () => {
    const { store, id, first, second, created, createChunkImage } =
      await failGrowth();

    const corrected = chunkFor({ sop: 'b', z: 1 });
    const result = await store.importChunks([corrected], { createChunkImage });
    await flush();

    // Identity, not shape: a chunk the batch could not apply stays unpinned.
    expect(created).toHaveLength(1);
    expect(result.volumes[id][1]).toBe(corrected);
    const grown = created[0].getChunks();
    expect(grown[0]).toBe(first);
    expect(grown[1]).toBe(corrected);
    expect(grown[1]).not.toBe(second);
    expect(store.volumeInfo[id].NumberOfSlices).toBe(2);
  });

  it('keeps a dissolved volume until its replacements exist', async () => {
    const { store, id, zero, two, loaded } = await loadSplittablePair();

    const failing = imageFactory({ onPrepare: failsAt(1) });
    await expect(
      store.importChunks([zero, two], {
        createChunkImage: failing.createChunkImage,
      })
    ).rejects.toThrow(/buffer/);

    // Stale IDs go last: the replan dissolves this one, but nothing replaced it.
    expect(cachedIds()).toEqual([id]);
    expect(store.volumeInfo[id].NumberOfSlices).toBe(2);
    expect(store.studyVolumes[STUDY_UID]).toEqual([id]);
    expect(loaded.created[0].disposeCount).toBe(0);
    expect(failing.created).toHaveLength(2);
    expect(failing.created.map((image) => image.disposeCount)).toEqual([1, 1]);
  });

  it('hands a dissolved volume to the given removal before reporting the commit', async () => {
    const { store, id, zero, two } = await loadSplittablePair();
    const calls: string[] = [];

    await store.importChunks([zero, two], {
      createChunkImage: imageFactory().createChunkImage,
      removeDissolved: (removed) => calls.push(`remove:${removed}`),
      onCommitted: ({ dissolved }) => calls.push(`commit:${dissolved.join()}`),
    });

    expect(calls).toEqual([`remove:${id}`, `commit:${id}`]);
    // The removal is the caller's whole, so the store evicted nothing itself.
    expect(cachedIds()).toContain(id);
    expect(store.volumeInfo[id]).toBeDefined();
  });

  it('removes the dissolved volume once the split commits', async () => {
    const { store, id, zero, one, two, three, loaded } =
      await loadSplittablePair();

    const split = imageFactory();
    const result = await store.importChunks([zero, two], {
      createChunkImage: split.createChunkImage,
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
    expect(loaded.created[0].disposeCount).toBe(1);
  });

  it('does not bring back a volume removed while its series was importing', async () => {
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    // The growth to two members waits until the test lets it settle.
    const { store, id, first, second, created, createChunkImage } =
      await loadOneSlice({
        onPrepare: (_index, chunks) =>
          chunks.length === 2 ? held : Promise.resolve(),
      });
    const growing = store.importChunks([second], { createChunkImage });
    await flush();
    useDatasetStore().remove(id);
    expect(cachedIds()).toEqual([]);
    release();

    await expect(growing).rejects.toThrow(/removed while its series/);
    expect(cachedIds()).toEqual([]);
    expect(store.volumeInfo[id]).toBeUndefined();
    expect(store.studyVolumes[STUDY_UID]).toBeUndefined();
    // The removed image is not asked to hold anything again.
    expect(created[0].setChunksCalls).toHaveLength(2);

    // The lane and registry stay usable: the series rebuilds from what a new
    // import brings, including the slice the abandoned batch carried.
    const again = await store.importChunks([first, second], {
      createChunkImage,
    });
    expect(store.volumeInfo[onlyId(again)].NumberOfSlices).toBe(2);
  });

  it('converges on the one-shot plan when one series is imported concurrently', async () => {
    const sops = (image: FakeChunkImage) =>
      (image.setChunksCalls.at(-1) ?? []).map(sopOf);

    const state = (created: FakeChunkImage[]) => {
      const store = useDICOMStore();
      return {
        volumes: Object.fromEntries(
          Object.entries(store.volumeInfo).map(([id, info]) => [
            id,
            info.NumberOfSlices,
          ])
        ),
        members: created.map(sops),
      };
    };

    const oneShot = async () => {
      setActivePinia(createPinia());
      const { created, createChunkImage } = imageFactory();
      await useDICOMStore().importChunks(
        [chunkFor({ sop: 'a', z: 0 }), chunkFor({ sop: 'b', z: 1 })],
        { createChunkImage }
      );
      return state(created);
    };

    const concurrent = async () => {
      setActivePinia(createPinia());
      const { created, createChunkImage } = imageFactory();
      const store = useDICOMStore();
      await Promise.all([
        store.importChunks([chunkFor({ sop: 'a', z: 0 })], {
          createChunkImage,
        }),
        store.importChunks([chunkFor({ sop: 'b', z: 1 })], {
          createChunkImage,
        }),
      ]);
      return state(created);
    };

    expect(await concurrent()).toEqual(await oneShot());
  });

  it('registers no cine image when a sibling candidate fails', async () => {
    const { createChunkImage } = imageFactory({ onPrepare: failsAt(0) });
    const store = useDICOMStore();
    const cine = cineChunkFor('cine');
    const slices = [chunkFor({ sop: 'a', z: 0 }), chunkFor({ sop: 'b', z: 1 })];

    await expect(
      store.importChunks([cine, ...slices], {
        createChunkImage,
        parseCineDicom: () => cineParseResult(cineHeader()),
      })
    ).rejects.toThrow(/buffer/);

    // A cine clip is a candidate like any other: it reaches no store alone.
    expect(cachedIds()).toEqual([]);
    expect(store.volumeInfo).toEqual({});
    expect(store.studyVolumes).toEqual({});
  });

  it('releases the chunks of a volume the user removed', async () => {
    const store = useDICOMStore();
    let chunk!: WeakRef<Chunk>;

    // The series keeps its other collection, so nothing that outlives the
    // import is emptied out from under the removed one.
    await (async () => {
      const { scout, slices } = scoutBatch();
      chunk = new WeakRef(scout);
      const { createChunkImage } = imageFactory();
      const { volumes } = await store.importChunks([scout, ...slices], {
        createChunkImage,
      });
      const removed = Object.entries(volumes).find(
        ([, chunks]) => chunks[0] === scout
      )![0];
      useDatasetStore().remove(removed);
    })();
    await collect();

    // Whatever the store and the registry still hold holds the removed
    // volume's DICOM bytes with it.
    expect(chunk.deref()).toBeUndefined();
  });

  it('lets another series commit while one series is still preparing', async () => {
    const { createChunkImage } = imageFactory({
      onPrepare: (_index, chunks) =>
        sopOf(chunks[0]) === 'stuck' ? never() : Promise.resolve(),
    });
    const store = useDICOMStore();

    store
      .importChunks([chunkFor({ sop: 'stuck', series: SERIES_UID })], {
        createChunkImage,
      })
      .catch(() => {});
    const other = store.importChunks(
      [chunkFor({ sop: 'other', series: OTHER_SERIES_UID })],
      { createChunkImage }
    );

    // Each series runs on its own chain, so an outstanding one blocks no other.
    const settled = await Promise.race([
      other.then(() => 'committed'),
      flush().then(() => 'blocked'),
    ]);
    expect(settled).toBe('committed');

    expect(
      Object.values(store.volumeInfo).map((i) => i.SeriesInstanceUID)
    ).toEqual([OTHER_SERIES_UID]);
  });
});

const sourceFor = (chunk: Chunk) => {
  const name = `${sopOf(chunk)}.dcm`;
  const source: DataSource = {
    type: 'chunk',
    chunk,
    mime: FILE_EXT_TO_MIME.dcm,
    parent: uriToDataSource(`https://ex/${name}`, name, FILE_EXT_TO_MIME.dcm),
  };
  return source as DataSource & ChunkSource;
};

const sopsOfDataset = (dataSource: DataSource | undefined) => {
  if (dataSource?.type !== 'collection') throw new Error('Expected collection');
  return dataSource.sources.map((src) => {
    if (src.type !== 'chunk') throw new Error('Expected a chunk source');
    return sopOf(src.chunk);
  });
};

/**
 * The pipeline's own shape: a series reaches the dataset store as it commits,
 * whether or not the import as a whole failed.
 */
const load = (
  chunks: Chunk[],
  createChunkImage: ReturnType<typeof imageFactory>['createChunkImage']
) =>
  importDicomChunkSources(chunks.map(sourceFor), (batch, hooks) =>
    useDICOMStore().importChunks(batch, { createChunkImage, ...hooks })
  );

/** A batch whose other series waits for the returned release. */
const gatedFactory = () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { createChunkImage } = imageFactory({
    onPrepare: (_index, chunks) =>
      sopOf(chunks[0]) === 'slow' ? gate : Promise.resolve(),
  });
  return { createChunkImage, release: () => release() };
};

const slowSibling = () => chunkFor({ sop: 'slow', series: OTHER_SERIES_UID });

describe('importDicomChunkSources transactional commit', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('leaves the dataset list and its provenance unchanged when a commit fails', async () => {
    const { zero, one, two, three } = splitting();
    const store = useDICOMStore();
    const datasetStore = useDatasetStore();

    const [loadable] = await load(
      [one, three],
      imageFactory().createChunkImage
    );
    const id = loadable.dataID;
    expect(sopsOfDataset(datasetStore.getDataSource(id))).toEqual([
      'sop-1',
      'sop-3',
    ]);

    await expect(
      load(
        [zero, two],
        imageFactory({ onPrepare: failsAt(1) }).createChunkImage
      )
    ).rejects.toThrow(/buffer/);

    expect(datasetStore.idsAsSelections).toEqual([id]);
    expect(sopsOfDataset(datasetStore.getDataSource(id))).toEqual([
      'sop-1',
      'sop-3',
    ]);
    expect(cachedIds()).toEqual([id]);
    expect(store.volumeInfo[id].NumberOfSlices).toBe(2);
  });

  it('keeps the membership a later import recorded while a sibling delays', async () => {
    const { createChunkImage, release } = gatedFactory();
    const store = useDICOMStore();
    const datasetStore = useDatasetStore();

    const delayed = load(
      [chunkFor({ sop: 'a', z: 0 }), slowSibling()],
      createChunkImage
    );
    await flush();
    const [grown] = await load(
      [chunkFor({ sop: 'b', z: 1 })],
      createChunkImage
    );
    release();
    await delayed;

    // The delayed batch reports the series as it stood when it committed, one
    // slice ago, so the saved sources would name half the volume.
    expect(sopsOfDataset(datasetStore.getDataSource(grown.dataID))).toEqual([
      'a',
      'b',
    ]);
    expect(store.volumeInfo[grown.dataID].NumberOfSlices).toBe(2);
  });

  it('leaves a dataset a later import dissolved removed', async () => {
    const { zero, one, two, three } = splitting();
    const { createChunkImage, release } = gatedFactory();
    const datasetStore = useDatasetStore();

    const delayed = load([one, three, slowSibling()], createChunkImage);
    await flush();
    const dissolvedId = datasetStore.idsAsSelections[0];
    const split = await load([zero, two], createChunkImage);
    release();
    await delayed;

    expect(datasetStore.getDataSource(dissolvedId)).toBeUndefined();
    // The dataset list names what is loaded and nothing else, so the delayed
    // batch brings back neither the collection nor its provenance.
    expect([...datasetStore.idsAsSelections].sort()).toEqual(
      [...cachedIds()].sort()
    );
    expect(
      split.map(({ dataID }) =>
        sopsOfDataset(datasetStore.getDataSource(dataID))
      )
    ).toContainEqual(['sop-0', 'sop-1']);
  });

  it('reports what a committed series landed and blames only what failed', async () => {
    const { zero, one, two, three } = splitting();
    const store = useDICOMStore();
    const datasetStore = useDatasetStore();

    const [loadable] = await load(
      [one, three],
      imageFactory().createChunkImage
    );
    const dissolvedId = loadable.dataID;

    // The split commits on its own lane while the second series never prepares.
    const failure = await load(
      [zero, two, chunkFor({ sop: 'other', series: OTHER_SERIES_UID })],
      imageFactory({
        onPrepare: (_index, chunks) =>
          sopOf(chunks[0]) === 'other'
            ? Promise.reject(new Error(BUFFER_FAILURE))
            : Promise.resolve(),
      }).createChunkImage
    ).then(
      () => null,
      (err) => err
    );

    expect(failure).toBeInstanceOf(PartialDicomImportError);
    expect((failure as Error).message).toMatch(/buffer/);

    // A committed series must not be reported as loaded and failed at once.
    expect(
      (failure as PartialDicomImportError).failedSources.map((src) =>
        sopOf(src.chunk)
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
