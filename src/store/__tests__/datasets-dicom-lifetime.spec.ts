import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import {
  blobFetcher,
  createDicomLoader,
  getChunkTag,
  Tags,
  type DicomLoader,
  type Fetcher,
} from '@/packages/dicom/core';
import { buildSyntheticDicom } from '@/tests/specs/syntheticDicom';
import { useDICOMStore } from '@/src/store/datasets-dicom';
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

  afterEach(() => loader.dispose());

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
});
