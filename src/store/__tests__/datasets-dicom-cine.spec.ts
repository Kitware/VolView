import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import type { Chunk } from '@/src/core/streaming/chunk';
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
import { isCineChunkGroup, useDICOMStore } from '@/src/store/datasets-dicom';

const mocks = vi.hoisted(() => {
  const chunkImages: MockDicomChunkImage[] = [];

  class MockDicomChunkImage {
    chunks: Chunk[] = [];
    name = '';

    constructor() {
      chunkImages.push(this);
    }

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

    isLoading() {
      return false;
    }

    addEventListener() {}

    removeEventListener() {}

    startLoad() {}

    dispose() {}
  }

  return {
    splitAndSort: vi.fn(),
    parseCineDicom: vi.fn(),
    chunkImages,
    MockDicomChunkImage,
  };
});

vi.mock('@/src/io/dicom', () => ({
  splitAndSort: mocks.splitAndSort,
}));

vi.mock('@/src/core/cine/parseCineDicom', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/src/core/cine/parseCineDicom')>();
  return {
    ...actual,
    parseCineDicom: mocks.parseCineDicom,
  };
});

vi.mock('@/src/core/streaming/dicomChunkImage', () => ({
  default: mocks.MockDicomChunkImage,
}));

function metadata(overrides: Record<string, string> = {}) {
  return (
    [
      [Tags.SOPClassUID, SOP_CLASS_ULTRASOUND_MULTIFRAME],
      [Tags.NumberOfFrames, '2'],
      [Tags.SOPInstanceUID, 'sop-uid'],
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
      [Tags.Modality, 'US'],
      [Tags.SeriesInstanceUID, 'series-uid'],
      [Tags.SeriesNumber, '7'],
      [Tags.SeriesDescription, 'Unsupported native cine'],
      [Tags.WindowLevel, ''],
      [Tags.WindowWidth, ''],
    ] as [string, string][]
  ).map(([tag, value]) => [tag, overrides[tag] ?? value]) as [string, string][];
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
      SOPInstanceUID: 'sop-uid',
      SOPClassUID: SOP_CLASS_ULTRASOUND_MULTIFRAME,
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
    mocks.splitAndSort.mockReset();
    mocks.parseCineDicom.mockReset();
    mocks.chunkImages.length = 0;
  });

  it('falls back to chunk import for unsupported parsed cine headers', async () => {
    const unsupportedCineChunk = chunk();
    const chunksByVolume = { 'volume-1': [unsupportedCineChunk] };
    mocks.splitAndSort.mockResolvedValue(chunksByVolume);
    mocks.parseCineDicom.mockReturnValue(parseResult(cineHeader()));

    const store = useDICOMStore();
    await expect(store.importChunks([unsupportedCineChunk])).resolves.toBe(
      chunksByVolume
    );

    expect(unsupportedCineChunk.loadData).toHaveBeenCalledOnce();
    expect(mocks.parseCineDicom).toHaveBeenCalledOnce();
    expect(mocks.chunkImages).toHaveLength(1);
    expect(mocks.chunkImages[0].chunks).toEqual([unsupportedCineChunk]);

    const imageCacheStore = useImageCacheStore();
    expect(imageCacheStore.imageById['volume-1']).toBe(mocks.chunkImages[0]);
    expect(store.volumeInfo['volume-1']).toMatchObject({
      NumberOfSlices: 1,
      VolumeID: 'volume-1',
      Modality: 'US',
      SeriesInstanceUID: 'series-uid',
      SeriesNumber: '7',
      SeriesDescription: 'Unsupported native cine',
    });
    expect(store.volumeInfo['volume-1'].kind).toBe('volume');
  });

  it('rejects cached non-chunk images before chunk-volume reuse', async () => {
    const normalChunk = chunk(
      metadata({
        [Tags.SOPClassUID]: '1.2.840.10008.5.1.4.1.1.2',
        [Tags.NumberOfFrames]: '1',
      })
    );
    const chunksByVolume = { 'volume-1': [normalChunk] };
    mocks.splitAndSort.mockResolvedValue(chunksByVolume);

    const imageCacheStore = useImageCacheStore();
    imageCacheStore.imageById['volume-1'] =
      {} as (typeof imageCacheStore.imageById)[string];

    const store = useDICOMStore();
    await expect(store.importChunks([normalChunk])).rejects.toThrow(
      /non-chunk progressive image/
    );
    expect(mocks.chunkImages).toHaveLength(0);
  });
});
