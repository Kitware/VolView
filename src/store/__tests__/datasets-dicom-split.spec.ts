import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import type { Chunk } from '@/src/core/streaming/chunk';
import { Tags } from '@/src/core/dicomTags';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useDICOMStore, getDisplayName } from '@/src/store/datasets-dicom';
import DicomChunkImage from '@/src/core/streaming/dicomChunkImage';
import { useDatasetStore } from '@/src/store/datasets';
import { uriToDataSource, type DataSource } from '@/src/io/import/dataSource';
import { FILE_EXT_TO_MIME } from '@/src/io/mimeTypes';

class FakeDicomChunkImage {
  chunks: Chunk[] = [];

  name = '';

  loading = { value: false };

  async addChunks(chunks: Chunk[]) {
    this.chunks = chunks;
  }

  getDicomMetadata() {
    return this.chunks[0].metadata;
  }

  getChunks() {
    return this.chunks.slice();
  }

  setName(name: string) {
    this.name = name;
  }

  getStatus() {
    return 'complete';
  }

  getVtkImageData() {
    return {
      getPointData: () => ({ getScalars: () => null }),
    };
  }

  isLoading() {
    return false;
  }

  isLoaded() {
    return true;
  }

  getImageMetadata() {
    return null;
  }

  addEventListener() {}

  removeEventListener() {}

  startLoad() {}

  dispose() {}
}

// The store only constructs the class and tests cached images against it, so a
// stand-in that holds chunks is enough. The real one decodes pixels through ITK.
const ChunkImage = FakeDicomChunkImage as unknown as typeof DicomChunkImage;

// The store's own grouping is what these tests exercise, so splitAndSort is
// handed a fixed answer rather than parsing the fixture blobs.
function importInto(
  store: ReturnType<typeof useDICOMStore>,
  chunks: Chunk[],
  groups: Record<string, Chunk[]>
) {
  return store.importChunks(chunks, async () => groups, ChunkImage);
}

function chunk(sopUid: string, z: number, acquisition?: string) {
  return {
    metadata: [
      ...(acquisition
        ? [[Tags.AcquisitionNumber, acquisition] as [string, string]]
        : []),
      [Tags.SOPClassUID, '1.2.840.10008.5.1.4.1.1.2'],
      [Tags.NumberOfFrames, '1'],
      [Tags.SOPInstanceUID, sopUid],
      [Tags.PatientID, 'patient-1'],
      [Tags.PatientName, 'Test Patient'],
      [Tags.PatientBirthDate, ''],
      [Tags.PatientSex, ''],
      [Tags.StudyID, 'study-1'],
      [Tags.StudyInstanceUID, 'study-uid'],
      [Tags.StudyDate, ''],
      [Tags.StudyTime, ''],
      [Tags.AccessionNumber, ''],
      [Tags.StudyDescription, ''],
      [Tags.Modality, 'CT'],
      [Tags.SeriesInstanceUID, 'series-uid'],
      [Tags.SeriesNumber, '2'],
      [Tags.SeriesDescription, 'CHEST'],
      [Tags.WindowLevel, ''],
      [Tags.WindowWidth, ''],
      [Tags.ImageOrientationPatient, '1\\0\\0\\0\\1\\0'],
      [Tags.ImagePositionPatient, `0\\0\\${z}`],
    ] as [string, string][],
    metaBlob: new Blob([new Uint8Array([1])]),
  } as unknown as Chunk;
}

function dataSource(chunks: Chunk[]): DataSource {
  return {
    type: 'collection',
    sources: chunks.map((item) => {
      const sopUid = new Map(item.metadata!).get(Tags.SOPInstanceUID)!;
      return {
        type: 'chunk',
        chunk: item,
        mime: FILE_EXT_TO_MIME.dcm,
        parent: uriToDataSource(
          `https://example.test/${sopUid}.dcm`,
          `${sopUid}.dcm`,
          FILE_EXT_TO_MIME.dcm
        ),
      };
    }),
  };
}

function sourceSopUids(source?: DataSource) {
  if (source?.type !== 'collection') return [];
  return source.sources.flatMap((item) => {
    if (item.type !== 'chunk') return [];
    const sopUid = new Map(item.chunk.metadata!).get(Tags.SOPInstanceUID);
    return sopUid ? [sopUid] : [];
  });
}

// A series whose acquisitions arrive in separate import calls must converge
// on the same volumes as one loaded at once: each call re-decides the split
// over every chunk imported so far, not just the chunks it carried in.
describe('DICOM store acquisition split across imports', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('re-splits a series imported one acquisition at a time', async () => {
    const store = useDICOMStore();
    const imageCacheStore = useImageCacheStore();
    const datasetStore = useDatasetStore();

    const acq1 = [0, 2.5, 5].map((z, i) => chunk(`acq1-${i}`, z, '1'));
    const acq2 = [0.75, 3.25, 5.75].map((z, i) => chunk(`acq2-${i}`, z, '2'));

    await importInto(store, acq1, { S: acq1 });
    datasetStore.addDataSources([
      { dataID: 'S', dataSource: dataSource(acq1) },
    ]);

    expect(Object.keys(store.volumeInfo)).toEqual(['S']);

    const volumes = await importInto(store, acq2, { S: acq2 });

    expect(Object.keys(volumes).sort()).toEqual(['S.1', 'S.2']);
    expect(Object.keys(store.volumeInfo).sort()).toEqual(['S.1', 'S.2']);
    expect(imageCacheStore.imageById.S).toBeUndefined();
    expect(store.volumeKeysByBase.S.sort()).toEqual(['S.1', 'S.2']);
    // The series description stays a verbatim tag mirror; the split shows up
    // in the display name.
    expect(store.volumeInfo['S.1'].SeriesDescription).toBe('CHEST');
    expect(store.volumeInfo['S.1'].splitLabel).toBe('acquisition 1');
    expect(store.volumeInfo['S.2'].splitLabel).toBe('acquisition 2');
    expect(getDisplayName(store.volumeInfo['S.1'])).toBe(
      'CHEST (acquisition 1)'
    );
    expect(getDisplayName(store.volumeInfo['S.2'])).toBe(
      'CHEST (acquisition 2)'
    );
    expect(volumes['S.1']).toHaveLength(3);
    expect(volumes['S.2']).toHaveLength(3);

    // The importer adds this call's sources after importChunks returns. The
    // store must already have migrated the first call's sources from S to
    // S.1, or saving now would omit acquisition 1 entirely.
    datasetStore.addDataSources([
      { dataID: 'S.2', dataSource: dataSource(acq2) },
    ]);
    expect(datasetStore.getDataSource('S')).toBeUndefined();
    expect(sourceSopUids(datasetStore.getDataSource('S.1'))).toEqual(
      acq1.map((item) => new Map(item.metadata!).get(Tags.SOPInstanceUID))
    );
    expect(sourceSopUids(datasetStore.getDataSource('S.2'))).toEqual(
      acq2.map((item) => new Map(item.metadata!).get(Tags.SOPInstanceUID))
    );
  });

  it('does not duplicate a subset re-imported after the full series', async () => {
    const store = useDICOMStore();
    const imageCacheStore = useImageCacheStore();

    const acq1 = [0, 2.5, 5].map((z, i) => chunk(`acq1-${i}`, z, '1'));
    const acq2 = [0.75, 3.25, 5.75].map((z, i) => chunk(`acq2-${i}`, z, '2'));

    await importInto(store, [...acq1, ...acq2], { S: [...acq1, ...acq2] });

    expect(Object.keys(store.volumeInfo).sort()).toEqual(['S.1', 'S.2']);

    // Re-import only acquisition 1 with fresh chunk objects carrying the same
    // SOPInstanceUIDs, as a second drag of the same files produces.
    const acq1Again = [0, 2.5, 5].map((z, i) => chunk(`acq1-${i}`, z, '1'));
    const volumes = await importInto(store, acq1Again, { S: acq1Again });

    expect(Object.keys(store.volumeInfo).sort()).toEqual(['S.1', 'S.2']);
    expect(imageCacheStore.imageById.S).toBeUndefined();
    expect(volumes['S.1']).toHaveLength(3);
    expect(volumes['S.2']).toHaveLength(3);
  });

  it('keeps an existing split when a later batch cannot be judged', async () => {
    const store = useDICOMStore();

    const acq1 = [0, 2.5, 5].map((z, i) => chunk(`acq1-${i}`, z, '1'));
    const acq2 = [0.75, 3.25, 5.75].map((z, i) => chunk(`acq2-${i}`, z, '2'));

    await importInto(store, [...acq1, ...acq2], { S: [...acq1, ...acq2] });

    expect(Object.keys(store.volumeInfo).sort()).toEqual(['S.1', 'S.2']);

    // A chunk with no AcquisitionNumber makes the accumulated set
    // unjudgeable. The split volumes must survive; the batch lands in its
    // own base volume instead of collapsing the series back together.
    const untagged = [chunk('untagged-0', 7.5)];
    await importInto(store, untagged, { S: untagged });

    expect(Object.keys(store.volumeInfo).sort()).toEqual(['S', 'S.1', 'S.2']);
    expect(store.volumeKeysByBase.S.sort()).toEqual(['S', 'S.1', 'S.2']);
  });

  it('converges to one volume when a later batch makes IDs collide', async () => {
    const store = useDICOMStore();

    const acq1 = [0, 2.5, 5].map((z, i) => chunk(`acq1-${i}`, z, '1'));
    const acq2 = [0.75, 3.25, 5.75].map((z, i) => chunk(`acq2-${i}`, z, '2'));

    await importInto(store, [...acq1, ...acq2], { S: [...acq1, ...acq2] });

    expect(Object.keys(store.volumeInfo).sort()).toEqual(['S.1', 'S.2']);

    // '+1' and '-1' both encode to the ID suffix 'D1'. The union cannot
    // split without silently dropping chunks, so the whole series must
    // converge to the single base volume, not re-split batch-only.
    const colliding = [chunk('plus-0', 10, '+1'), chunk('minus-0', 10.5, '-1')];
    const volumes = await importInto(store, colliding, { S: colliding });

    expect(Object.keys(volumes)).toEqual(['S']);
    expect(Object.keys(store.volumeInfo)).toEqual(['S']);
    expect(store.volumeKeysByBase.S).toEqual(['S']);
    expect(volumes.S).toHaveLength(8);
  });
});
