import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import type { Chunk } from '@/src/core/streaming/chunk';
import type DicomChunkImage from '@/src/core/streaming/dicomChunkImage';
import { useImageCacheStore } from '@/src/store/image-cache';
import {
  useDICOMStore,
  type ImportChunksResult,
} from '@/src/store/datasets-dicom';
import { mergingChunks } from '@/src/core/dicom/__tests__/orientationFixtures';
import {
  chunkFor,
  imageFactory,
  FakeChunkImage,
  OTHER_SERIES_UID,
  SERIES_UID,
  STUDY_UID,
} from '@/src/store/__tests__/dicomImportFixtures';

// Holds every setChunks until `open`, so two imports can be in flight at once.
function deferredImageFactory() {
  const created: FakeChunkImage[] = [];
  const pending: Array<() => void> = [];
  let opened = false;

  const createChunkImage = () => {
    const image = new FakeChunkImage(created.length);
    const { setChunks } = image;
    image.setChunks = (chunks: Chunk[], orientation: number[] | null) =>
      new Promise<void>((resolve) => {
        const apply = () => resolve(setChunks.call(image, chunks, orientation));
        if (opened) apply();
        else pending.push(apply);
      });
    created.push(image);
    return image as unknown as DicomChunkImage;
  };

  const open = () => {
    opened = true;
    pending.splice(0).forEach((apply) => apply());
  };

  return { created, createChunkImage, open };
}

const onlyId = ({ volumes }: ImportChunksResult) => {
  const ids = Object.keys(volumes);
  expect(ids).toHaveLength(1);
  return ids[0];
};

describe('DICOM store incremental import', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('asks an already-registered image to load the chunks a re-import adds', async () => {
    const { created, createChunkImage } = imageFactory();
    const first = chunkFor({ sop: 'a', z: 0 });
    const second = chunkFor({ sop: 'b', z: 1 });

    const store = useDICOMStore();
    const firstResult = await store.importChunks([first], { createChunkImage });
    const secondResult = await store.importChunks([second], {
      createChunkImage,
    });

    expect(created).toHaveLength(1);
    const [image] = created;
    expect(image.setChunksCalls).toEqual([[first], [first, second]]);
    expect(image.startLoadCount).toBe(2);

    const id = onlyId(firstResult);
    expect(onlyId(secondResult)).toBe(id);
    expect(useImageCacheStore().imageById[id]).toBe(image);
    // Every member reports back, so the dataset's provenance stays complete.
    expect(secondResult.volumes[id]).toEqual([first, second]);
  });

  it('hands the image the planned order, not the arrival order', async () => {
    const { created, createChunkImage } = imageFactory();
    const first = chunkFor({ sop: 'a', z: 0 });
    const second = chunkFor({ sop: 'b', z: 1 });

    const store = useDICOMStore();
    await store.importChunks([second], { createChunkImage });
    await store.importChunks([first], { createChunkImage });

    expect(created[0].setChunksCalls).toEqual([[second], [first, second]]);
  });

  it('gives one series the same volume id however it is imported', async () => {
    const load = async (batches: string[][]) => {
      setActivePinia(createPinia());
      const { createChunkImage } = imageFactory();
      const store = useDICOMStore();
      return batches.reduce(
        (chain, batch) =>
          chain.then(() =>
            store
              .importChunks(
                batch.map((sop) => chunkFor({ sop, z: sop.charCodeAt(0) })),
                { createChunkImage }
              )
              .then(onlyId)
          ),
        Promise.resolve('')
      );
    };

    const oneBatch = await load([['a', 'b', 'c']]);
    expect(await load([['a'], ['b', 'c']])).toBe(oneBatch);
    expect(await load([['b', 'c'], ['a']])).toBe(oneBatch);
    expect(
      await load([
        ['a', 'b', 'c'],
        ['a', 'b', 'c'],
      ])
    ).toBe(oneBatch);
  });

  it('keeps one member when the same instance arrives twice', async () => {
    const { created, createChunkImage } = imageFactory();
    const original = chunkFor({ sop: 'a', z: 0 });
    const resupplied = chunkFor({ sop: 'a', z: 0 });

    const store = useDICOMStore();
    const first = await store.importChunks([original], { createChunkImage });
    const second = await store.importChunks([resupplied], { createChunkImage });

    expect(created).toHaveLength(1);
    expect(created[0].setChunksCalls).toEqual([[original], [original]]);
    expect(second.volumes[onlyId(first)]).toEqual([resupplied]);
    expect(store.volumeInfo[onlyId(first)].NumberOfSlices).toBe(1);
  });

  it('counts every member of the volume after a re-import', async () => {
    const { createChunkImage } = imageFactory();
    const store = useDICOMStore();

    const first = await store.importChunks([chunkFor({ sop: 'a', z: 0 })], {
      createChunkImage,
    });
    await store.importChunks([chunkFor({ sop: 'b', z: 1 })], {
      createChunkImage,
    });

    expect(store.volumeInfo[onlyId(first)].NumberOfSlices).toBe(2);
  });

  it('splits incompatible instances of one series into two volumes', async () => {
    const { created, createChunkImage } = imageFactory();
    const scout = chunkFor({ sop: 'scout', rows: '8', z: 0 });
    const slices = [chunkFor({ sop: 'a', z: 0 }), chunkFor({ sop: 'b', z: 1 })];

    const store = useDICOMStore();
    const result = await store.importChunks([scout, ...slices], {
      createChunkImage,
    });

    expect(created).toHaveLength(2);
    const ids = Object.keys(result.volumes);
    expect(ids).toHaveLength(2);
    expect(Object.values(result.volumes)).toContainEqual([scout]);
    expect(Object.values(result.volumes)).toContainEqual(slices);

    const imageCacheStore = useImageCacheStore();
    ids.forEach((id) => expect(imageCacheStore.imageById[id]).toBeDefined());
    expect(ids.map((id) => store.volumeInfo[id].NumberOfSlices).sort()).toEqual(
      [1, 2]
    );
    expect(store.studyVolumes[STUDY_UID].sort()).toEqual([...ids].sort());
  });

  it('rebuilds a removed series from the chunks the re-import brings', async () => {
    const { created, createChunkImage } = imageFactory();
    const store = useDICOMStore();
    const original = chunkFor({ sop: 'a', z: 0 });

    const id = onlyId(
      await store.importChunks([original], { createChunkImage })
    );
    useImageCacheStore().removeImage(id);
    store.deleteVolume(id);

    const resupplied = chunkFor({ sop: 'a', z: 0 });
    const reimported = onlyId(
      await store.importChunks([resupplied], { createChunkImage })
    );

    expect(reimported).toBe(id);
    expect(created).toHaveLength(2);
    // Identity, not shape: the released chunk is an equal but stale object.
    expect(created[1].setChunksCalls).toHaveLength(1);
    expect(created[1].setChunksCalls[0]).toHaveLength(1);
    expect(created[1].setChunksCalls[0][0]).toBe(resupplied);
  });

  const merging = () => mergingChunks(chunkFor);

  it('drops the volume a replan dissolved', async () => {
    const { createChunkImage } = imageFactory();
    const store = useDICOMStore();
    const imageCacheStore = useImageCacheStore();
    const { between, straight, tilted } = merging();

    const first = await store.importChunks([straight, tilted], {
      createChunkImage,
    });
    const ids = Object.keys(first.volumes);
    expect(ids).toHaveLength(2);

    const merged = await store.importChunks([between], { createChunkImage });
    const survivor = onlyId(merged);
    const dissolved = ids.find((id) => id !== survivor)!;

    expect(store.volumeInfo[dissolved]).toBeUndefined();
    expect(imageCacheStore.imageById[dissolved]).toBeUndefined();
    expect(store.studyVolumes[STUDY_UID]).toEqual([survivor]);
    expect(store.volumeInfo[survivor].NumberOfSlices).toBe(3);
    // The caller has to drop the dataset the dissolved id owned, and the
    // survivor has to carry the provenance of the member it inherited.
    expect(merged.dissolved).toEqual([dissolved]);
    expect(merged.volumes[survivor]).toEqual([straight, tilted, between]);
  });

  it('does not resurrect a volume a concurrent import dissolved', async () => {
    const { createChunkImage, open } = deferredImageFactory();
    const store = useDICOMStore();
    const imageCacheStore = useImageCacheStore();
    const { between, straight, tilted } = merging();

    const firstImport = store.importChunks([straight, tilted], {
      createChunkImage,
    });
    const secondImport = store.importChunks([between], { createChunkImage });
    open();
    const first = await firstImport;
    const survivor = onlyId(await secondImport);

    Object.keys(first.volumes)
      .filter((id) => id !== survivor)
      .forEach((id) => {
        expect(imageCacheStore.imageById[id]).toBeUndefined();
        expect(store.volumeInfo[id]).toBeUndefined();
      });
    expect(store.volumeInfo[survivor].NumberOfSlices).toBe(3);
  });

  it('lets a corrected re-import replace the chunk a failed import brought', async () => {
    const created: FakeChunkImage[] = [];
    let failing = true;
    const createChunkImage = () => {
      const image = new FakeChunkImage(created.length);
      const { setChunks } = image;
      image.setChunks = async (
        chunks: Chunk[],
        orientation: number[] | null
      ) => {
        if (failing) throw new Error('cannot allocate the volume buffer');
        return setChunks.call(image, chunks, orientation);
      };
      created.push(image);
      return image as unknown as DicomChunkImage;
    };

    const store = useDICOMStore();
    await expect(
      store.importChunks([chunkFor({ sop: 'a', z: 0 })], { createChunkImage })
    ).rejects.toThrow(/buffer/);

    failing = false;
    const corrected = chunkFor({ sop: 'a', z: 0 });
    await store.importChunks([corrected], { createChunkImage });

    const image = created.at(-1)!;
    expect(image.setChunksCalls).toHaveLength(1);
    // Identity, not shape: the failed import must not pin its chunk.
    expect(image.setChunksCalls[0][0]).toBe(corrected);
  });

  it('keeps two series in one batch apart', async () => {
    const { createChunkImage } = imageFactory();
    const first = chunkFor({ sop: 'a', series: SERIES_UID });
    const second = chunkFor({ sop: 'b', series: OTHER_SERIES_UID });

    const store = useDICOMStore();
    const result = await store.importChunks([first, second], {
      createChunkImage,
    });

    const ids = Object.keys(result.volumes);
    expect(ids).toHaveLength(2);
    expect(
      ids.map((id) => store.volumeInfo[id].SeriesInstanceUID).sort()
    ).toEqual([SERIES_UID, OTHER_SERIES_UID].sort());
  });
});
