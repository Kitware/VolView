import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import {
  blobFetcher,
  createDicomLoader,
  getChunkTag,
  Tags,
  type DicomLoader,
  type Fetcher,
} from '@/packages/dicom/core';
import {
  buildSyntheticCineDicom,
  buildSyntheticDicom,
} from '@/tests/specs/syntheticDicom';
import { useDICOMStore } from '@/src/store/datasets-dicom';
import { useImageCacheStore } from '@/src/store/image-cache';
import DicomChunkImage from '@/src/core/streaming/dicomChunkImage';
import DicomCineImage from '@/src/core/cine/DicomCineImage';
import { parseCineDicom } from '@/src/core/cine/parseCineDicom';
import {
  imageFactory,
  SERIES_UID,
  STUDY_UID,
} from '@/src/store/__tests__/dicomImportFixtures';

const fileFor = (sop: string, z = 0, orientation = '1\\0\\0\\0\\1\\0') =>
  new Blob([
    buildSyntheticDicom({
      studyUid: STUDY_UID,
      seriesUid: SERIES_UID,
      sopUid: sop,
      instanceNumber: z + 1,
      imageOrientationPatient: orientation.split('\\').map(Number) as [
        number,
        number,
        number,
        number,
        number,
        number,
      ],
      imagePositionPatient: [0, 0, z],
    }) as BlobPart,
  ]);

const deferred = () => {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const ultrasoundFile = (sop: string, z: number, angle: number) =>
  new Blob([
    buildSyntheticDicom({
      studyUid: STUDY_UID,
      seriesUid: SERIES_UID,
      sopUid: sop,
      sopClassUid: '1.2.840.10008.5.1.4.1.1.6.1',
      modality: 'US',
      bitsAllocated: 8,
      ultrasoundRegion: { physicalDeltaX: 0.1, physicalDeltaY: 0.1 },
      instanceNumber: z + 1,
      imageOrientationPatient: [
        Math.cos(angle),
        Math.sin(angle),
        0,
        -Math.sin(angle),
        Math.cos(angle),
        0,
      ],
      imagePositionPatient: [0, 0, z],
    }) as BlobPart,
  ]);

/** A complete header followed by a pixel request held until its source is closed. */
function gatedPixelSource(file: Blob) {
  const inner = blobFetcher(file);
  let rejectPending: ((error: Error) => void) | undefined;
  let started = () => {};
  let cancelled = 0;
  const pending = new Promise<void>((resolve) => {
    started = resolve;
  });
  const source: Fetcher = {
    ...inner,
    blob: () =>
      new Promise<Blob>((_resolve, reject) => {
        rejectPending = reject;
        started();
      }),
    close() {
      inner.close();
      if (!rejectPending) return;
      cancelled += 1;
      rejectPending(new DOMException('pixel source cancelled', 'AbortError'));
      rejectPending = undefined;
    },
  };
  return { source, pending, cancellations: () => cancelled };
}

describe('DICOM source ownership in the application store', () => {
  let loader: DicomLoader;

  beforeEach(() => {
    setActivePinia(createPinia());
    loader = createDicomLoader();
  });

  afterEach(async () => {
    const cache = useImageCacheStore();
    [...cache.imageIds].forEach(cache.removeImage);
    await nextTick();
    loader.dispose();
  });

  const removeVolume = (id: string) => {
    useDICOMStore().deleteVolume(id);
    useImageCacheStore().removeImage(id);
  };

  const loaded = async (source: Blob | Fetcher) => {
    const chunk = loader.createChunk(source);
    await chunk.loadMeta();
    await chunk.loadData();
    return chunk;
  };

  it('releases a duplicate source while preserving its provenance and the canonical bytes', async () => {
    const file = fileFor('1.2.3.4');
    const canonical = await loaded(file);
    const duplicate = await loaded(file);
    const { created, createChunkImage } = imageFactory();
    const store = useDICOMStore();
    const first = await store.importChunks([canonical], { createChunkImage });
    const repeated = await store.importChunks([duplicate], {
      createChunkImage,
    });
    const [id] = Object.keys(first.volumes);

    expect(created[0].getChunks()).toEqual([canonical]);
    expect(repeated.volumes[id]).toEqual([duplicate]);
    expect(duplicate.dataBlob).toBeUndefined();
    expect(getChunkTag(duplicate, Tags.SOPInstanceUID)?.trim()).toBe('1.2.3.4');
    expect(canonical.dataBlob).toBeInstanceOf(Blob);
    await expect(duplicate.loadData()).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('cancels a pending pixel request when its volume is deleted', async () => {
    const gated = gatedPixelSource(fileFor('1.2.3.5'));
    const chunk = loader.createChunk(gated.source);
    await chunk.loadMeta();
    const { createChunkImage } = imageFactory();
    const store = useDICOMStore();
    const result = await store.importChunks([chunk], { createChunkImage });
    const pendingData = chunk.loadData();
    const cancelled = expect(pendingData).rejects.toMatchObject({
      name: 'AbortError',
    });
    await gated.pending;

    store.deleteVolume(Object.keys(result.volumes)[0]);

    await cancelled;
    expect(gated.cancellations()).toBe(1);
    expect(chunk.dataBlob).toBeUndefined();
    expect(Object.keys(store.volumeInfo)).toEqual([]);
    expect(getChunkTag(chunk, Tags.SOPInstanceUID)?.trim()).toBe('1.2.3.5');
  });

  it('releases sources deleted by the committed callback', async () => {
    const chunk = await loaded(fileFor('1.2.3.5'));
    const { createChunkImage } = imageFactory();
    const store = useDICOMStore();
    await store.importChunks([chunk], {
      createChunkImage,
      onCommitted: ({ volumes }) => {
        removeVolume(Object.keys(volumes)[0]);
      },
    });

    expect(Object.keys(store.volumeInfo)).toEqual([]);
    await expect(chunk.loadData()).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it.each([false, true])(
    'releases a collection deleted as the next import starts planning (re-supplied: %s)',
    async (resupplied) => {
      const previous = await loaded(fileFor('1.2.3.5'));
      const incoming = await loaded(fileFor('1.2.3.6', 1));
      const { createChunkImage } = imageFactory();
      const store = useDICOMStore();
      const initial = await store.importChunks([previous], {
        createChunkImage,
      });
      const pending = store.importChunks(
        resupplied ? [previous, incoming] : [incoming],
        { createChunkImage }
      );
      const rolledBack = expect(pending).rejects.toThrow(/removed/);

      await Promise.resolve();
      removeVolume(Object.keys(initial.volumes)[0]);
      await rolledBack;

      await expect(previous.loadData()).rejects.toMatchObject({
        name: 'AbortError',
      });
      await expect(incoming.loadData()).resolves.toBeUndefined();
    }
  );

  it('retains bytes transferred out of a dissolved collection until the survivor is deleted', async () => {
    const [between, straight, tilted] = await Promise.all(
      [
        [1, 2, 0.01],
        [2, 0, 0],
        [3, 1, 0.02],
      ].map(([sop, z, angle]) => {
        const c = Math.cos(angle);
        const s = Math.sin(angle);
        return loaded(
          fileFor(`1.2.3.${sop}`, z, [c, s, 0, -s, c, 0].join('\\'))
        );
      })
    );
    const store = useDICOMStore();
    const { createChunkImage } = imageFactory();
    const initial = await store.importChunks([straight, tilted], {
      createChunkImage,
    });
    expect(Object.keys(initial.volumes)).toHaveLength(2);

    const merged = await store.importChunks([between], { createChunkImage });
    expect(merged.dissolved).toHaveLength(1);
    const [survivor] = Object.keys(merged.volumes);
    expect(merged.volumes[survivor]).toEqual([straight, tilted, between]);
    [straight, tilted, between].forEach((chunk) =>
      expect(chunk.dataBlob).toBeInstanceOf(Blob)
    );

    store.deleteVolume(survivor);
    [straight, tilted, between].forEach((chunk) =>
      expect(chunk.dataBlob).toBeUndefined()
    );
  });

  it('lets the caller release a failed preparation before supplying corrected bytes', async () => {
    const failed = await loaded(fileFor('1.2.3.6'));
    const store = useDICOMStore();
    const failing = imageFactory({
      onPrepare: async () => {
        throw new Error('allocation rejected');
      },
    });
    await expect(
      store.importChunks([failed], {
        createChunkImage: failing.createChunkImage,
      })
    ).rejects.toThrow('allocation rejected');
    expect(failed.dataBlob).toBeInstanceOf(Blob);
    await expect(failed.loadData()).resolves.toBeUndefined();
    store.releaseUnregisteredChunks([failed]);
    expect(failed.dataBlob).toBeUndefined();

    const corrected = await loaded(fileFor('1.2.3.6'));
    const { created, createChunkImage } = imageFactory();
    await store.importChunks([corrected], { createChunkImage });
    expect(created[0].getChunks()).toEqual([corrected]);
    expect(corrected.dataBlob).toBeInstanceOf(Blob);
  });

  it.each(['survivor', 'dissolving'] as const)(
    'reconciles deletion of the planned %s after a pending merge rolls back',
    async (removed) => {
      const between = await loaded(ultrasoundFile('1.2.3.1', 2, 0.01));
      const straight = await loaded(ultrasoundFile('1.2.3.2', 0, 0));
      const tilted = await loaded(ultrasoundFile('1.2.3.3', 1, 0.02));
      const cineFile = new Blob([
        buildSyntheticCineDicom({
          studyUid: STUDY_UID,
          seriesUid: SERIES_UID,
          sopUid: '1.2.3.9',
        }) as BlobPart,
      ]);
      expect(
        DicomCineImage.isSupported(
          parseCineDicom(await cineFile.arrayBuffer()).header
        )
      ).toBe(true);
      const cineStarted = deferred();
      const cineGate = deferred();
      const volumePrepared = deferred();
      const source = blobFetcher(cineFile);
      const cine = loader.createChunk({
        ...source,
        blob: async () => {
          cineStarted.resolve();
          await cineGate.promise;
          return source.blob();
        },
      });
      await cine.loadMeta();

      const createChunkImage = () => {
        const image = new DicomChunkImage({
          readDicomImage: async () =>
            ({
              image: {
                size: [4, 4, 1],
                imageType: { components: 1 },
                data: new Uint8Array(16),
              },
            }) as never,
        });
        image.addEventListener('status', () => {
          if (image.getChunks().length === 3) volumePrepared.resolve();
        });
        return image;
      };
      const store = useDICOMStore();
      const cache = useImageCacheStore();
      const initial = await store.importChunks([straight, tilted], {
        createChunkImage,
      });
      expect(Object.keys(initial.volumes)).toHaveLength(2);
      // Re-supplied original members still belong to their visible collections.
      const pending = store.importChunks([between, cine, straight, tilted], {
        createChunkImage,
      });
      const rolledBack = expect(pending).rejects.toThrow(/removed/);
      await Promise.all([cineStarted.promise, volumePrepared.promise]);
      const survivorId = Object.keys(initial.volumes).find(
        (id) =>
          (cache.imageById[id] as DicomChunkImage).getChunks().length === 3
      )!;
      const dissolvingId = Object.keys(initial.volumes).find(
        (id) => id !== survivorId
      )!;
      const removedId = removed === 'survivor' ? survivorId : dissolvingId;
      const retainedId = removed === 'survivor' ? dissolvingId : survivorId;
      const removedChunk = initial.volumes[removedId][0];
      const retainedChunk = initial.volumes[retainedId][0];

      removeVolume(removedId);
      cineGate.resolve();
      await rolledBack;

      expect(store.volumeInfo[removedId]).toBeUndefined();
      expect(store.volumeInfo[retainedId].NumberOfSlices).toBe(1);
      await expect(retainedChunk.loadData()).resolves.toBeUndefined();
      await expect(removedChunk.loadData()).rejects.toMatchObject({
        name: 'AbortError',
      });
      expect(removedChunk.dataBlob).toBeUndefined();
      // A direct import failure leaves the incoming sources with its caller.
      await expect(between.loadData()).resolves.toBeUndefined();
      await expect(cine.loadData()).resolves.toBeUndefined();

      const angle = retainedChunk === straight ? 0 : 0.02;
      const fresh = await loaded(
        ultrasoundFile(
          retainedChunk === straight ? '1.2.3.2' : '1.2.3.3',
          retainedChunk === straight ? 0 : 1,
          angle
        )
      );
      const extra = await loaded(ultrasoundFile('1.2.3.10', 3, angle));
      const retried = await store.importChunks([fresh, extra], {
        createChunkImage,
      });
      expect(Object.keys(retried.volumes)).toEqual([retainedId]);
      expect(store.volumeInfo[retainedId].NumberOfSlices).toBe(2);
      await expect(retainedChunk.loadData()).resolves.toBeUndefined();

      store.releaseUnregisteredChunks([between, cine]);
      await expect(between.loadData()).rejects.toMatchObject({
        name: 'AbortError',
      });
      removeVolume(retainedId);
    }
  );
});
