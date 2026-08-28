import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import type { Chunk } from '@/src/core/streaming/chunk';
import { Tags } from '@/src/core/dicomTags';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useDICOMStore } from '@/src/store/datasets-dicom';

const mocks = vi.hoisted(() => {
  const chunkImages: MockDicomChunkImage[] = [];

  class MockDicomChunkImage {
    additions: Chunk[][] = [];
    startLoadCount = 0;
    name = '';

    constructor() {
      chunkImages.push(this);
    }

    async addChunks(chunks: Chunk[]) {
      this.additions.push(chunks);
    }

    getDicomMetadata() {
      return this.additions.at(-1)![0].metadata;
    }

    getChunks() {
      return this.additions.at(-1)!.slice();
    }

    setName(name: string) {
      this.name = name;
    }

    getStatus() {
      return 'incomplete';
    }

    isLoading() {
      return false;
    }

    addEventListener() {}

    removeEventListener() {}

    startLoad() {
      this.startLoadCount += 1;
    }

    dispose() {}
  }

  return { splitAndSort: vi.fn(), chunkImages, MockDicomChunkImage };
});

// eslint-disable-next-line no-restricted-syntax -- DICOM splitting runs in wasm; unavailable in the node test environment
vi.mock('@/src/io/dicom', () => ({
  splitAndSort: mocks.splitAndSort,
}));

// eslint-disable-next-line no-restricted-syntax -- needs a streaming chunk source the node environment cannot provide
vi.mock('@/src/core/streaming/dicomChunkImage', () => ({
  default: mocks.MockDicomChunkImage,
}));

function chunk(sopInstanceUid: string) {
  const metadata = [
    [Tags.SOPClassUID, '1.2.840.10008.5.1.4.1.1.2'],
    [Tags.NumberOfFrames, '1'],
    [Tags.SOPInstanceUID, sopInstanceUid],
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
    [Tags.SeriesNumber, '7'],
    [Tags.SeriesDescription, 'Incremental series'],
    [Tags.WindowLevel, ''],
    [Tags.WindowWidth, ''],
  ] as [string, string][];
  return {
    metadata,
    metaBlob: new Blob([new Uint8Array([1])]),
    dataBlob: new Blob([new Uint8Array([2])]),
    loadData: vi.fn().mockResolvedValue(undefined),
  } as unknown as Chunk;
}

describe('DICOM store incremental import', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mocks.splitAndSort.mockReset();
    mocks.chunkImages.length = 0;
  });

  it('asks an already-registered image to load the chunks a re-import adds', async () => {
    const first = chunk('sop-1');
    const second = chunk('sop-2');
    mocks.splitAndSort
      .mockResolvedValueOnce({ 'volume-1': [first] })
      .mockResolvedValueOnce({ 'volume-1': [first, second] });

    const store = useDICOMStore();
    await store.importChunks([first]);
    await store.importChunks([second]);

    expect(mocks.chunkImages).toHaveLength(1);
    const [image] = mocks.chunkImages;
    expect(image.additions).toEqual([[first], [first, second]]);
    expect(image.startLoadCount).toBe(2);
    expect(useImageCacheStore().imageById['volume-1']).toBe(image);
  });
});
