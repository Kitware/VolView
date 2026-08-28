import { describe, it, expect, vi } from 'vitest';
import { Chunk } from '@/src/core/streaming/chunk';
import { ChunkState } from '@/src/core/streaming/chunkStateMachine';
import { Tags } from '@/src/core/dicomTags';
import DicomChunkImage, {
  DicomChunkImageInit,
} from '@/src/core/streaming/dicomChunkImage';
import { ChunkStatus } from '@/src/core/streaming/chunkImage';

const ROWS = 2;
const COLUMNS = 2;
const PIXELS_PER_SLICE = ROWS * COLUMNS;
const PUBLIC_DSC_SLOPE = 112067.85375182;

function metadataFor(z: number, overrides: Record<string, string> = {}) {
  const metadata = [
    [Tags.SOPInstanceUID, `1.2.3.${z}`],
    [Tags.ImagePositionPatient, `0\\0\\${z}`],
    [Tags.ImageOrientationPatient, '1\\0\\0\\0\\1\\0'],
    [Tags.Rows, String(ROWS)],
    [Tags.Columns, String(COLUMNS)],
    [Tags.PixelSpacing, '1\\1'],
    [Tags.BitsStored, '16'],
    [Tags.PixelRepresentation, '0'],
    [Tags.SamplesPerPixel, '1'],
  ] as Array<[string, string]>;
  Object.entries(overrides).forEach(([tag, value]) => {
    const existing = metadata.find((entry) => entry[0] === tag);
    if (existing) existing[1] = value;
    else metadata.push([tag, value]);
  });
  return metadata;
}

// The slice's z position is also its pixel value, so the decoded contents of a
// slice identify which chunk it came from.
async function makeLoadedChunk(
  z: number,
  overrides: Record<string, string> = {}
) {
  const meta = metadataFor(z, overrides);
  const chunk = new Chunk({
    metaLoader: {
      meta,
      metaBlob: new Blob([`meta-${z}`]),
      load: () => {},
      stop: () => {},
    },
    dataLoader: {
      data: new Blob([String(z)]),
      load: () => {},
      stop: () => {},
    },
  });
  await chunk.loadMeta();
  await chunk.loadData();
  expect(chunk.state).toBe(ChunkState.Loaded);
  return chunk;
}

function zOf(chunk: Chunk) {
  const meta = Object.fromEntries(chunk.metadata!);
  return Number(meta[Tags.ImagePositionPatient].split('\\')[2]);
}

function splitAndSortByPosition(chunks: Chunk[]) {
  return Promise.resolve({
    volume: [...chunks].sort((a, b) => zOf(a) - zOf(b)),
  });
}

// Decodes a chunk to a constant frame, letting the test choose the array type.
function decodeTo(dataFor: (value: number) => ArrayLike<number>) {
  const read: DicomChunkImageInit['readDicomImage'] = async (file) => {
    const value = Number(await file.text());
    return {
      image: {
        size: [COLUMNS, ROWS, 1],
        data: dataFor(value) as Uint16Array,
        imageType: { components: 1 },
      },
    };
  };
  return read;
}

const readDicomImage = decodeTo((value) =>
  new Uint16Array(PIXELS_PER_SLICE).fill(value)
);

function sliceOf(image: DicomChunkImage, index: number) {
  const scalars = image.getVtkImageData().getPointData().getScalars();
  const data = scalars.getData();
  return Array.from(
    data.slice(index * PIXELS_PER_SLICE, (index + 1) * PIXELS_PER_SLICE)
  );
}

async function loadRejectingSeries(
  read: DicomChunkImageInit['readDicomImage']
) {
  const image = new DicomChunkImage({
    splitAndSort: splitAndSortByPosition,
    readDicomImage: read,
  });
  const errors: unknown[] = [];
  image.addEventListener('chunkError', ({ error }) => {
    errors.push(error);
  });
  const [valid, invalid] = await Promise.all([
    makeLoadedChunk(1, { [Tags.BitsStored]: '8' }),
    makeLoadedChunk(2, { [Tags.BitsStored]: '8' }),
  ]);

  await image.addChunks([valid, invalid]);
  await vi.waitFor(() =>
    expect(image.getChunkStatuses()).toEqual([
      ChunkStatus.Loaded,
      ChunkStatus.Errored,
    ])
  );

  expect(image.status.value).toBe('complete');
  expect(errors).toHaveLength(1);
  expect(sliceOf(image, 0)).toEqual(Array(PIXELS_PER_SLICE).fill(1));
  expect(sliceOf(image, 1)).toEqual(Array(PIXELS_PER_SLICE).fill(0));
  image.dispose();
  return String(errors[0]);
}

describe('DicomChunkImage', () => {
  it('preserves exact modality-rescaled pixels from the public DSC series', async () => {
    // The public frames are 200x230; reduced geometry keeps the exact encoding,
    // rescale, and an observed stored-pixel maximum in a focused volume test.
    const decoded = Float64Array.from([
      0,
      PUBLIC_DSC_SLOPE,
      2 * PUBLIC_DSC_SLOPE,
      65131 * PUBLIC_DSC_SLOPE,
    ]);
    const image = new DicomChunkImage({
      splitAndSort: splitAndSortByPosition,
      readDicomImage: decodeTo(() => decoded),
    });
    const frame = await makeLoadedChunk(1, {
      [Tags.SeriesInstanceUID]:
        '1.3.6.1.4.1.9590.100.1.2.284777661700890778225181143863199482857',
      [Tags.RescaleSlope]: String(PUBLIC_DSC_SLOPE),
      [Tags.RescaleIntercept]: '0',
    });

    await image.addChunks([frame]);
    await vi.waitFor(() =>
      expect(image.getChunkStatuses()).toEqual([ChunkStatus.Loaded])
    );

    const data = image.getVtkImageData().getPointData().getScalars().getData();
    expect(data).toBeInstanceOf(Float64Array);
    expect(Array.from(data)).toEqual(Array.from(decoded));

    image.dispose();
  });

  it('settles after rejecting decoded values its integer buffer cannot hold', async () => {
    const message = await loadRejectingSeries(
      decodeTo((value) =>
        value === 2
          ? new Uint16Array(PIXELS_PER_SLICE).fill(5000)
          : new Uint8Array(PIXELS_PER_SLICE).fill(value)
      )
    );
    expect(message).toContain('5000');
    expect(message).toContain('Uint8Array');
  });

  it('settles after rejecting fractional samples bound for an integer buffer', async () => {
    const message = await loadRejectingSeries(
      decodeTo((value) =>
        value === 2
          ? new Float64Array(PIXELS_PER_SLICE).fill(2.5)
          : new Uint8Array(PIXELS_PER_SLICE).fill(value)
      )
    );
    expect(message).toContain('fractional');
    expect(message).toContain('Uint8Array');
  });

  it('serializes concurrent additions so an older sort cannot drop newer chunks', async () => {
    const pendingSorts: Array<{
      chunks: Chunk[];
      resolve: (volumes: Record<string, Chunk[]>) => void;
    }> = [];
    const deferredSplitAndSort: DicomChunkImageInit['splitAndSort'] = (
      chunks
    ) =>
      new Promise((resolve) => {
        pendingSorts.push({ chunks: [...chunks], resolve });
      });
    const finishSort = (index: number) => {
      pendingSorts[index].resolve({
        volume: [...pendingSorts[index].chunks].sort((a, b) => zOf(a) - zOf(b)),
      });
    };
    const image = new DicomChunkImage({
      splitAndSort: deferredSplitAndSort,
      readDicomImage,
    });
    const [first, second] = await Promise.all([
      makeLoadedChunk(1),
      makeLoadedChunk(2),
    ]);

    const olderAddition = image.addChunks([second]);
    await vi.waitFor(() => expect(pendingSorts).toHaveLength(1));

    const newerAddition = image.addChunks([first]);
    await Promise.resolve();
    expect(pendingSorts).toHaveLength(1);

    finishSort(0);
    await olderAddition;
    await vi.waitFor(() => expect(pendingSorts).toHaveLength(2));
    expect(pendingSorts[1].chunks.map(zOf)).toEqual([2, 1]);

    finishSort(1);
    await newerAddition;
    await vi.waitFor(() =>
      expect(image.getChunkStatuses()).toEqual([
        ChunkStatus.Loaded,
        ChunkStatus.Loaded,
      ])
    );

    expect(image.getChunks().map(zOf)).toEqual([1, 2]);
    expect(sliceOf(image, 0)).toEqual(Array(PIXELS_PER_SLICE).fill(1));
    expect(sliceOf(image, 1)).toEqual(Array(PIXELS_PER_SLICE).fill(2));

    image.dispose();
  });

  it('decodes every loaded chunk into its sorted slice position', async () => {
    const image = new DicomChunkImage({
      splitAndSort: splitAndSortByPosition,
      readDicomImage,
    });

    const loads: Array<{ z: number; zRange: number[] }> = [];
    image.addEventListener('chunkLoad', ({ chunk, updatedExtent }) => {
      loads.push({ z: zOf(chunk), zRange: updatedExtent.slice(4) });
    });

    const [first, second, third] = await Promise.all([
      makeLoadedChunk(1),
      makeLoadedChunk(2),
      makeLoadedChunk(3),
    ]);

    await image.addChunks([first]);
    await vi.waitFor(() => expect(loads.length).toBe(1));

    // Arrival order deliberately differs from slice order.
    await image.addChunks([third, second]);
    await vi.waitFor(() => expect(loads.length).toBe(4));

    expect(image.getChunks().map(zOf)).toEqual([1, 2, 3]);
    // The first slice is redecoded because reallocation cleared its pixels.
    expect(loads).toEqual([
      { z: 1, zRange: [0, 0] },
      { z: 1, zRange: [0, 0] },
      { z: 2, zRange: [1, 1] },
      { z: 3, zRange: [2, 2] },
    ]);
    expect(sliceOf(image, 0)).toEqual(Array(PIXELS_PER_SLICE).fill(1));
    expect(sliceOf(image, 1)).toEqual(Array(PIXELS_PER_SLICE).fill(2));
    expect(sliceOf(image, 2)).toEqual(Array(PIXELS_PER_SLICE).fill(3));

    image.dispose();
  });

  it('keeps a stale in-flight decode from clobbering the re-sorted volume', async () => {
    // Hold each decode independently by its pixel value.
    const pending = new Map<number, Array<() => void>>();
    const deferredRead: DicomChunkImageInit['readDicomImage'] = async (
      file
    ) => {
      const value = Number(await file.text());
      return new Promise((resolve) => {
        const resolvers = pending.get(value) ?? [];
        resolvers.push(() =>
          resolve({
            image: {
              size: [COLUMNS, ROWS, 1],
              data: new Uint16Array(PIXELS_PER_SLICE).fill(value),
              imageType: { components: 1 },
            },
          })
        );
        pending.set(value, resolvers);
      });
    };

    const image = new DicomChunkImage({
      splitAndSort: splitAndSortByPosition,
      readDicomImage: deferredRead,
    });

    let loads = 0;
    image.addEventListener('chunkLoad', () => {
      loads += 1;
    });

    const [first, second, third] = await Promise.all([
      makeLoadedChunk(1),
      makeLoadedChunk(2),
      makeLoadedChunk(3),
    ]);

    // Start chunk 3 in slot 0, then move it to slot 2 while decoding.
    await image.addChunks([third]);
    await vi.waitFor(() => expect(pending.get(3)).toHaveLength(1));

    await image.addChunks([first, second]);
    await vi.waitFor(() => {
      expect(pending.get(1)).toHaveLength(1);
      expect(pending.get(2)).toHaveLength(1);
      expect(pending.get(3)).toHaveLength(2);
    });

    // Complete the current decodes before the stale attempt.
    pending.get(1)![0]();
    pending.get(2)![0]();
    pending.get(3)![1]();
    await vi.waitFor(() => expect(loads).toBe(3));

    pending.get(3)![0]();
    await Promise.resolve();
    await Promise.resolve();
    expect(loads).toBe(3);

    expect(sliceOf(image, 0)).toEqual(Array(PIXELS_PER_SLICE).fill(1));
    expect(sliceOf(image, 1)).toEqual(Array(PIXELS_PER_SLICE).fill(2));
    expect(sliceOf(image, 2)).toEqual(Array(PIXELS_PER_SLICE).fill(3));

    image.dispose();
  });

  it('does not let a stale success overwrite a replacement failure', async () => {
    // Hold each decode independently by its pixel value.
    const pending = new Map<number, Array<(err?: Error) => void>>();
    const deferredRead: DicomChunkImageInit['readDicomImage'] = async (
      file
    ) => {
      const value = Number(await file.text());
      return new Promise((resolve, reject) => {
        const settlers = pending.get(value) ?? [];
        settlers.push((err) => {
          if (err) reject(err);
          else
            resolve({
              image: {
                size: [COLUMNS, ROWS, 1],
                data: new Uint16Array(PIXELS_PER_SLICE).fill(value),
                imageType: { components: 1 },
              },
            });
        });
        pending.set(value, settlers);
      });
    };

    const image = new DicomChunkImage({
      splitAndSort: splitAndSortByPosition,
      readDicomImage: deferredRead,
    });

    const errors: number[] = [];
    image.addEventListener('chunkError', ({ chunk }) => {
      errors.push(zOf(chunk));
    });

    const [first, second, third] = await Promise.all([
      makeLoadedChunk(1),
      makeLoadedChunk(2),
      makeLoadedChunk(3),
    ]);

    // Start chunk 3 in slot 0, then move it to slot 2 while decoding.
    await image.addChunks([third]);
    await vi.waitFor(() => expect(pending.get(3)).toHaveLength(1));

    await image.addChunks([first, second]);
    await vi.waitFor(() => expect(pending.get(3)).toHaveLength(2));

    pending.get(1)![0]();
    pending.get(2)![0]();
    await vi.waitFor(() =>
      expect(image.getChunkStatuses()[1]).toBe(ChunkStatus.Loaded)
    );

    // Fail the attempt for the current allocation.
    pending.get(3)![1](new Error('replacement decode failed'));
    await vi.waitFor(() => expect(errors).toEqual([3]));

    expect(image.getChunkStatuses()).toEqual([
      ChunkStatus.Loaded,
      ChunkStatus.Loaded,
      ChunkStatus.Errored,
    ]);
    expect(sliceOf(image, 0)).toEqual(Array(PIXELS_PER_SLICE).fill(1));

    // A late success from the previous allocation must be ignored.
    pending.get(3)![0]();
    await Promise.resolve();
    await Promise.resolve();
    expect(image.getChunkStatuses()[2]).toBe(ChunkStatus.Errored);
    expect(sliceOf(image, 2)).toEqual(Array(PIXELS_PER_SLICE).fill(0));

    image.dispose();
  });

  it('does not let a stale failure overwrite a replacement success', async () => {
    const pending = new Map<number, Array<(err?: Error) => void>>();
    const deferredRead: DicomChunkImageInit['readDicomImage'] = async (
      file
    ) => {
      const value = Number(await file.text());
      return new Promise((resolve, reject) => {
        const settlers = pending.get(value) ?? [];
        settlers.push((err) => {
          if (err) reject(err);
          else
            resolve({
              image: {
                size: [COLUMNS, ROWS, 1],
                data: new Uint16Array(PIXELS_PER_SLICE).fill(value),
                imageType: { components: 1 },
              },
            });
        });
        pending.set(value, settlers);
      });
    };

    const image = new DicomChunkImage({
      splitAndSort: splitAndSortByPosition,
      readDicomImage: deferredRead,
    });

    const errors: number[] = [];
    image.addEventListener('chunkError', ({ chunk }) => {
      errors.push(zOf(chunk));
    });

    const [first, second, third] = await Promise.all([
      makeLoadedChunk(1),
      makeLoadedChunk(2),
      makeLoadedChunk(3),
    ]);

    await image.addChunks([third]);
    await vi.waitFor(() => expect(pending.get(3)).toHaveLength(1));

    await image.addChunks([first, second]);
    await vi.waitFor(() => expect(pending.get(3)).toHaveLength(2));

    pending.get(1)![0]();
    pending.get(2)![0]();
    pending.get(3)![1]();
    await vi.waitFor(() =>
      expect(image.getChunkStatuses()).toEqual([
        ChunkStatus.Loaded,
        ChunkStatus.Loaded,
        ChunkStatus.Loaded,
      ])
    );

    // A late failure from the previous allocation must be ignored.
    pending.get(3)![0](new Error('stale decode failed'));
    await Promise.resolve();
    await Promise.resolve();
    expect(errors).toEqual([]);
    expect(image.getChunkStatuses()[2]).toBe(ChunkStatus.Loaded);
    expect(sliceOf(image, 2)).toEqual(Array(PIXELS_PER_SLICE).fill(3));

    image.dispose();
  });

  it('reports a reallocated chunk as loading until its slice is rewritten', async () => {
    const pending: Array<() => void> = [];
    const deferredRead: DicomChunkImageInit['readDicomImage'] = async (
      file
    ) => {
      const value = Number(await file.text());
      return new Promise((resolve) => {
        pending.push(() =>
          resolve({
            image: {
              size: [COLUMNS, ROWS, 1],
              data: new Uint16Array(PIXELS_PER_SLICE).fill(value),
              imageType: { components: 1 },
            },
          })
        );
      });
    };

    const image = new DicomChunkImage({
      splitAndSort: splitAndSortByPosition,
      readDicomImage: deferredRead,
    });

    const [first, second] = await Promise.all([
      makeLoadedChunk(1),
      makeLoadedChunk(2),
    ]);

    await image.addChunks([first]);
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    pending[0]();
    await vi.waitFor(() => expect(image.status.value).toBe('complete'));

    // Reallocation cleared chunk 1, and neither replacement decode has run.
    await image.addChunks([second]);

    expect(image.getChunkStatuses()).toEqual([
      ChunkStatus.Loading,
      ChunkStatus.Loading,
    ]);
    expect(image.status.value).toBe('incomplete');
    expect(sliceOf(image, 0)).toEqual(Array(PIXELS_PER_SLICE).fill(0));

    await vi.waitFor(() => expect(pending).toHaveLength(3));
    pending.slice(1).forEach((settle) => settle());
    await vi.waitFor(() => expect(image.status.value).toBe('complete'));
    expect(sliceOf(image, 0)).toEqual(Array(PIXELS_PER_SLICE).fill(1));
    expect(sliceOf(image, 1)).toEqual(Array(PIXELS_PER_SLICE).fill(2));

    image.dispose();
  });
});
