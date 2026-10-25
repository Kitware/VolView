import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import type { Chunk } from '@/src/core/streaming/chunk';
import type DicomChunkImage from '@/src/core/streaming/dicomChunkImage';
import {
  SOP_CLASS_ULTRASOUND_MULTIFRAME,
  SOP_CLASS_ULTRASOUND_MULTIFRAME_RETIRED,
  Tags,
} from '@/src/core/dicomTags';
import type {
  CineHeader,
  CineParseResult,
} from '@/src/core/cine/parseCineDicom';
import { useImageCacheStore } from '@/src/store/image-cache';
import { instanceTags } from '@/src/store/__tests__/dicomTagFixtures';
import {
  isCineChunkGroup,
  useDICOMStore,
  type ImportChunksResult,
} from '@/src/store/datasets-dicom';

class FakeChunkImage {
  orientation: number[] | null = null;

  getOrientation() {
    return this.orientation;
  }

  chunks: Chunk[] = [];

  name = '';

  async setChunks(chunks: Chunk[], orientation: number[] | null) {
    this.chunks = chunks;
    this.orientation = orientation;
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

  isLoading() {
    return false;
  }

  addEventListener() {}

  removeEventListener() {}

  startLoad() {}

  dispose() {}
}

function imageFactory() {
  const created: FakeChunkImage[] = [];
  const createChunkImage = () => {
    const image = new FakeChunkImage();
    created.push(image);
    return image as unknown as DicomChunkImage;
  };
  return { created, createChunkImage };
}

function metadata(overrides: Record<string, string> = {}) {
  return instanceTags({
    sopClassUid: SOP_CLASS_ULTRASOUND_MULTIFRAME,
    numberOfFrames: '2',
    sopInstanceUid: 'sop-uid',
    modality: 'US',
    seriesDescription: 'Unsupported native cine',
  }).map(([tag, value]) => [tag, overrides[tag] ?? value]) as [
    string,
    string,
  ][];
}

function cineHeader(overrides: Partial<CineHeader> = {}): CineHeader {
  return {
    transferSyntaxUID: '1.2.840.10008.1.2.1',
    rows: 2,
    cols: 2,
    numberOfFrames: 2,
    samplesPerPixel: 1,
    bitsAllocated: 8,
    planarConfiguration: 0,
    photometricInterpretation: 'MONOCHROME1',
    pixelSpacing: null,
    frameTimeMs: null,
    patient: {
      PatientID: 'patient-1',
      PatientName: 'Test Patient',
      PatientBirthDate: '',
      PatientSex: '',
    },
    study: {
      StudyID: 'study-1',
      StudyInstanceUID: 'study-uid',
      StudyDate: '',
      StudyTime: '',
      AccessionNumber: '',
      StudyDescription: '',
    },
    series: {
      SeriesInstanceUID: 'series-uid',
      SeriesNumber: '7',
      SeriesDescription: 'Unsupported native cine',
      Modality: 'US',
    },
    regions: [],
    ...overrides,
  };
}

function parseResult(header: CineHeader): CineParseResult {
  return {
    header,
    frames: [new Uint8Array([1, 2, 3, 4]), new Uint8Array([5, 6, 7, 8])],
    encapsulated: false,
  };
}

function chunk(meta = metadata()) {
  return {
    metadata: meta,
    metaBlob: new Blob([new Uint8Array([1])]),
    dataBlob: new Blob([new Uint8Array([2])]),
    loadData: vi.fn().mockResolvedValue(undefined),
  } as unknown as Chunk;
}

const onlyId = (volumes: Record<string, Chunk[]>) => {
  const ids = Object.keys(volumes);
  expect(ids).toHaveLength(1);
  return ids[0];
};

describe('isCineChunkGroup', () => {
  it('accepts a single current ultrasound multi-frame image with more than one frame', () => {
    expect(isCineChunkGroup([chunk()])).toBe(true);
  });

  it('accepts the retired ultrasound multi-frame SOP class UID', () => {
    expect(
      isCineChunkGroup([
        chunk(
          metadata({
            [Tags.SOPClassUID]: SOP_CLASS_ULTRASOUND_MULTIFRAME_RETIRED,
          })
        ),
      ])
    ).toBe(true);
  });

  it('rejects multi-chunk groups', () => {
    expect(isCineChunkGroup([chunk(), chunk()])).toBe(false);
  });

  it('rejects non-ultrasound SOP classes', () => {
    expect(
      isCineChunkGroup([
        chunk(
          metadata({
            [Tags.SOPClassUID]: '1.2.840.10008.5.1.4.1.1.2',
          })
        ),
      ])
    ).toBe(false);
  });

  it('rejects single-frame images', () => {
    expect(
      isCineChunkGroup([
        chunk(
          metadata({
            [Tags.NumberOfFrames]: '1',
          })
        ),
      ])
    ).toBe(false);
  });
});

describe('DICOM store cine routing', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('falls back to chunk import for unsupported parsed cine headers', async () => {
    const { created, createChunkImage } = imageFactory();
    const parseCineDicom = vi.fn(() => parseResult(cineHeader()));
    const unsupportedCineChunk = chunk();

    const store = useDICOMStore();
    const result = await store.importChunks([unsupportedCineChunk], {
      createChunkImage,
      parseCineDicom,
    });

    expect(unsupportedCineChunk.loadData).toHaveBeenCalledOnce();
    expect(parseCineDicom).toHaveBeenCalledOnce();
    expect(created).toHaveLength(1);
    expect(created[0].chunks).toEqual([unsupportedCineChunk]);

    const id = onlyId(result.volumes);
    expect(result.volumes[id]).toEqual([unsupportedCineChunk]);
    expect(useImageCacheStore().imageById[id]).toBe(created[0]);
    expect(store.volumeInfo[id]).toMatchObject({
      NumberOfSlices: 1,
      VolumeID: id,
      Modality: 'US',
      SeriesInstanceUID: 'series-uid',
      SeriesNumber: '7',
      SeriesDescription: 'Unsupported native cine',
      kind: 'volume',
    });
  });

  it('falls back to chunk import when cine parsing throws', async () => {
    const { created, createChunkImage } = imageFactory();
    const parseCineDicom = vi.fn(() => {
      throw new Error('unsupported encapsulated frame layout');
    });
    const malformedCineChunk = chunk();

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = useDICOMStore();
    let result: ImportChunksResult;
    try {
      result = await store.importChunks([malformedCineChunk], {
        createChunkImage,
        parseCineDicom,
      });
    } finally {
      warn.mockRestore();
    }

    expect(malformedCineChunk.loadData).toHaveBeenCalledOnce();
    expect(parseCineDicom).toHaveBeenCalledOnce();
    expect(created).toHaveLength(1);
    expect(created[0].chunks).toEqual([malformedCineChunk]);

    const id = onlyId(result!.volumes);
    expect(useImageCacheStore().imageById[id]).toBe(created[0]);
    expect(store.volumeInfo[id].kind).toBe('volume');
  });

  it('refuses to reuse a cached image that cannot hold chunks', async () => {
    const parseCineDicom = vi.fn(() => parseResult(cineHeader()));
    const normalChunk = () =>
      chunk(
        metadata({
          [Tags.SOPClassUID]: '1.2.840.10008.5.1.4.1.1.2',
          [Tags.NumberOfFrames]: '1',
        })
      );

    const learner = imageFactory();
    const learned = await useDICOMStore().importChunks([normalChunk()], {
      createChunkImage: learner.createChunkImage,
      parseCineDicom,
    });
    const id = onlyId(learned.volumes);

    // A fresh session plans the same id, but the cache holds a foreign image.
    setActivePinia(createPinia());
    const imageCacheStore = useImageCacheStore();
    imageCacheStore.imageById[id] =
      {} as (typeof imageCacheStore.imageById)[string];

    const { created, createChunkImage } = imageFactory();
    await expect(
      useDICOMStore().importChunks([normalChunk()], {
        createChunkImage,
        parseCineDicom,
      })
    ).rejects.toThrow(/chunk/i);
    expect(created).toHaveLength(0);
  });
});
