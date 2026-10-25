import { describe, it, expect, vi } from 'vitest';
import { Chunk } from '@/src/core/streaming/chunk';
import { ChunkState } from '@/src/core/streaming/chunkStateMachine';
import { Tags } from '@/src/core/dicomTags';
import DicomChunkImage, {
  DicomChunkImageInit,
} from '@/src/core/streaming/dicomChunkImage';
import {
  sliceToThumbnail,
  type ThumbnailSlice,
} from '@/src/core/streaming/dicomThumbnail';
import { ChunkStatus } from '@/src/core/streaming/chunkImage';
import {
  US_UNIT_CENTIMETERS,
  UltrasoundRegions,
} from '@/src/core/streaming/dicom/ultrasoundRegion';

const AXIAL = [1, 0, 0, 0, 1, 0];
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
  overrides: Record<string, string> = {},
  ultrasoundRegions?: UltrasoundRegions
) {
  const meta = metadataFor(z, overrides);
  const chunk = new Chunk({
    metaLoader: {
      meta,
      metaBlob: new Blob([`meta-${z}`]),
      ultrasoundRegions,
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

// A chunk whose metadata only arrives when the test releases it.
function makeGatedChunk(z: number) {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const metaLoader = {
    meta: null as ReturnType<typeof metadataFor> | null,
    metaBlob: new Blob([`meta-${z}`]),
    load: () =>
      gate.then(() => {
        metaLoader.meta = metadataFor(z);
      }),
    stop: () => {},
  };
  const chunk = new Chunk({
    metaLoader,
    dataLoader: {
      data: new Blob([String(z)]),
      load: () => {},
      stop: () => {},
    },
  });
  return { chunk, release };
}

function zOf(chunk: Chunk) {
  const meta = Object.fromEntries(chunk.metadata!);
  return Number(meta[Tags.ImagePositionPatient].split('\\')[2]);
}

const frameOf = (value: number) => ({
  image: {
    size: [COLUMNS, ROWS, 1],
    data: new Uint16Array(PIXELS_PER_SLICE).fill(value),
    imageType: { components: 1 },
  },
});

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

// Records the files handed to a reader without changing what it returns.
function countingReader(read: DicomChunkImageInit['readDicomImage']) {
  const files: File[] = [];
  const counted: DicomChunkImageInit['readDicomImage'] = (file) => {
    files.push(file);
    return read(file);
  };
  return { files, read: counted };
}

// Holds every decode until the test settles it, indexed by its pixel value so
// each attempt at one chunk can be settled on its own.
function deferredReader() {
  const files: File[] = [];
  const attempts = new Map<number, Array<(error?: Error) => void>>();

  const read: DicomChunkImageInit['readDicomImage'] = async (file) => {
    files.push(file);
    const value = Number(await file.text());
    return new Promise((resolve, reject) => {
      const settlers = attempts.get(value) ?? [];
      settlers.push((error) =>
        error ? reject(error) : resolve(frameOf(value))
      );
      attempts.set(value, settlers);
    });
  };

  const countFor = (value: number) => attempts.get(value)?.length ?? 0;
  const total = () =>
    [...attempts.values()].reduce((sum, list) => sum + list.length, 0);
  const settle = (value: number, attempt: number, error?: Error) =>
    attempts.get(value)![attempt](error);
  const settleAll = (value: number) =>
    attempts.get(value)!.forEach((settler) => settler());

  return { files, read, countFor, total, settle, settleAll };
}

function capturingEncoder() {
  const slices: ThumbnailSlice[] = [];
  const encodeThumbnail = (slice: ThumbnailSlice) => {
    slices.push(slice);
    return `uri:${Array.from(slice.data).join(',')}`;
  };
  return { slices, encodeThumbnail };
}

function sliceOf(image: DicomChunkImage, index: number) {
  const scalars = image.getVtkImageData().getPointData().getScalars();
  const data = scalars.getData();
  return Array.from(
    data.slice(index * PIXELS_PER_SLICE, (index + 1) * PIXELS_PER_SLICE)
  );
}

function scalarRange(image: DicomChunkImage) {
  const [min, max] = image
    .getVtkImageData()
    .getPointData()
    .getScalars()
    .getRange();
  return [min, max] as [number, number];
}

const filledWith = (value: number) => Array(PIXELS_PER_SLICE).fill(value);

it('updates the axes when a replan keeps the same members', async () => {
  const chunk = await makeLoadedChunk(0);
  const image = new DicomChunkImage({
    readDicomImage: decodeTo(() => new Uint16Array(4)),
  });
  await image.setChunks([chunk], AXIAL);
  const previous = image.getVtkImageData();
  const angle = 0.001;
  const orientation = [
    Math.cos(angle),
    Math.sin(angle),
    0,
    -Math.sin(angle),
    Math.cos(angle),
    0,
  ];

  await image.setChunks([chunk], orientation);

  expect(image.getChunks()).toEqual([chunk]);
  expect(image.getVtkImageData()).not.toBe(previous);
  expect(image.getVtkImageData().getDirection().slice(0, 6)).toEqual(
    orientation
  );
  image.dispose();
});

async function loadRejectingSeries(
  read: DicomChunkImageInit['readDicomImage']
) {
  const image = new DicomChunkImage({ readDicomImage: read });
  const errors: unknown[] = [];
  image.addEventListener('chunkError', ({ error }) => {
    errors.push(error);
  });
  const [valid, invalid] = await Promise.all([
    makeLoadedChunk(1, { [Tags.BitsStored]: '8' }),
    makeLoadedChunk(2, { [Tags.BitsStored]: '8' }),
  ]);

  await image.setChunks([valid, invalid], AXIAL);
  await vi.waitFor(() =>
    expect(image.getChunkStatuses()).toEqual([
      ChunkStatus.Loaded,
      ChunkStatus.Errored,
    ])
  );

  expect(image.status.value).toBe('complete');
  expect(errors).toHaveLength(1);
  expect(sliceOf(image, 0)).toEqual(filledWith(1));
  expect(sliceOf(image, 1)).toEqual(filledWith(0));
  image.dispose();
  return String(errors[0]);
}

// The three slices of the reordering and race cases, in decode order 1, 2, 3.
function threeChunks() {
  return Promise.all([
    makeLoadedChunk(1),
    makeLoadedChunk(2),
    makeLoadedChunk(3),
  ]);
}

const allLoaded = (count: number) =>
  Array(count).fill(ChunkStatus.Loaded) as ChunkStatus[];

// Chunk 3 moves from slot 0 to slot 2 with both decode attempts outstanding.
async function imageWithReorderedChunk() {
  const reader = deferredReader();
  const image = new DicomChunkImage({ readDicomImage: reader.read });
  const errors: number[] = [];
  image.addEventListener('chunkError', ({ chunk }) => {
    errors.push(zOf(chunk));
  });
  const [first, second, third] = await threeChunks();

  await image.setChunks([third], AXIAL);
  await vi.waitFor(() => expect(reader.countFor(3)).toBe(1));
  await image.setChunks([first, second, third], AXIAL);
  await vi.waitFor(() => expect(reader.total()).toBe(4));

  return { reader, image, errors };
}

async function thumbnailFixture(read = readDicomImage) {
  const encoder = capturingEncoder();
  const image = new DicomChunkImage({
    readDicomImage: read,
    encodeThumbnail: encoder.encodeThumbnail,
  });
  const chunks = await threeChunks();
  await image.setChunks(chunks, AXIAL);
  return { image, encoder, chunks };
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
      readDicomImage: decodeTo(() => decoded),
    });
    const frame = await makeLoadedChunk(1, {
      [Tags.SeriesInstanceUID]:
        '1.3.6.1.4.1.9590.100.1.2.284777661700890778225181143863199482857',
      [Tags.RescaleSlope]: String(PUBLIC_DSC_SLOPE),
      [Tags.RescaleIntercept]: '0',
    });

    await image.setChunks([frame], AXIAL);
    await vi.waitFor(() =>
      expect(image.getChunkStatuses()).toEqual(allLoaded(1))
    );

    const data = image.getVtkImageData().getPointData().getScalars().getData();
    expect(data).toBeInstanceOf(Float64Array);
    expect(Array.from(data)).toEqual(Array.from(decoded));

    image.dispose();
  });

  // PixelSpacing is row\column, so the fallback in-plane spacing is [0.7, 0.6].
  it.each([
    { physicalDeltaX: 0.05, expected: [0.5, 0.3], warnings: 0 },
    { physicalDeltaX: 0, expected: [0.7, 0.6], warnings: 1 },
  ])(
    'applies ultrasound region spacing only when nonzero and finite (deltaX $physicalDeltaX)',
    async ({ physicalDeltaX, expected, warnings }) => {
      const warn = vi.fn();
      const image = new DicomChunkImage({ readDicomImage, warn });
      const frame = await makeLoadedChunk(
        1,
        { [Tags.Modality]: 'US', [Tags.PixelSpacing]: '0.6\\0.7' },
        {
          region: {
            physicalDeltaX,
            physicalDeltaY: 0.03,
            physicalUnitsXDirection: US_UNIT_CENTIMETERS,
            physicalUnitsYDirection: US_UNIT_CENTIMETERS,
          },
          regionCount: 1,
        }
      );

      await image.setChunks([frame], AXIAL);

      const [x, y] = image.getVtkImageData().getSpacing();
      expect(x).toBeCloseTo(expected[0]);
      expect(y).toBeCloseTo(expected[1]);
      expect(warn).toHaveBeenCalledTimes(warnings);
      image.dispose();
    }
  );

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

  // Grouping and ordering belong to the collection planner, so the image keeps
  // the order it is handed even when it disagrees with the slice positions.
  it('keeps the given order instead of regrouping its chunks', async () => {
    const image = new DicomChunkImage({ readDicomImage });
    const [first, second, third] = await threeChunks();

    await image.setChunks([third, first, second], AXIAL);
    await vi.waitFor(() =>
      expect(image.getChunkStatuses()).toEqual(allLoaded(3))
    );

    expect(image.getChunks().map(zOf)).toEqual([3, 1, 2]);
    expect(sliceOf(image, 0)).toEqual(filledWith(3));
    expect(sliceOf(image, 1)).toEqual(filledWith(1));
    expect(sliceOf(image, 2)).toEqual(filledWith(2));

    image.dispose();
  });

  it('leaves the volume alone when given the membership it already holds', async () => {
    const reader = deferredReader();
    const image = new DicomChunkImage({ readDicomImage: reader.read });
    const [first, second] = await threeChunks();

    await image.setChunks([first, second], AXIAL);
    reader.settleAll(1);
    reader.settleAll(2);
    await vi.waitFor(() =>
      expect(image.getChunkStatuses()).toEqual(allLoaded(2))
    );
    const buffer = image.getVtkImageData();

    await image.setChunks([first, second], AXIAL);

    expect(image.getVtkImageData()).toBe(buffer);
    expect(image.getChunkStatuses()).toEqual(allLoaded(2));
    expect(reader.countFor(1)).toBe(1);
    expect(reader.countFor(2)).toBe(1);

    image.dispose();
  });

  it('reports nothing loading when started with every slot already settled', async () => {
    const image = new DicomChunkImage({ readDicomImage });
    const [first, second] = await threeChunks();

    await image.setChunks([first, second], AXIAL);
    await vi.waitFor(() =>
      expect(image.getChunkStatuses()).toEqual(allLoaded(2))
    );
    expect(image.loading.value).toBe(false);

    // The store commits by starting the load after preparation, whether the
    // image is new or was handed the members it already holds.
    await image.setChunks([first, second], AXIAL);
    image.startLoad();

    expect(image.loading.value).toBe(false);
    expect(image.loaded.value).toBe(true);

    image.dispose();
  });

  it('reports loading when started with slots still to decode', async () => {
    const reader = deferredReader();
    const image = new DicomChunkImage({ readDicomImage: reader.read });
    const [first] = await threeChunks();

    await image.setChunks([first], AXIAL);
    image.startLoad();
    expect(image.loading.value).toBe(true);

    reader.settleAll(1);
    await vi.waitFor(() => expect(image.loading.value).toBe(false));
    expect(image.loaded.value).toBe(true);

    image.dispose();
  });

  it('stays disposed when a membership change was still reading metadata', async () => {
    const reader = deferredReader();
    const image = new DicomChunkImage({ readDicomImage: reader.read });
    const { chunk: gated, release } = makeGatedChunk(1);

    const pending = image.setChunks([gated], AXIAL);
    image.dispose();
    release();
    await pending;

    expect(image.getChunks()).toEqual([]);
    expect(image.getChunkStatuses()).toEqual([]);
    expect(reader.total()).toBe(0);
  });

  it('replaces its membership, dropping a chunk the new order omits', async () => {
    const reader = deferredReader();
    const image = new DicomChunkImage({ readDicomImage: reader.read });
    const errors: unknown[] = [];
    image.addEventListener('chunkError', ({ error }) => {
      errors.push(error);
    });

    const [first, second] = await threeChunks();

    await image.setChunks([first, second], AXIAL);
    await vi.waitFor(() => expect(reader.countFor(1)).toBe(1));

    await image.setChunks([second], AXIAL);
    expect(image.getChunks()).toEqual([second]);
    expect(image.getChunkStatuses()).toHaveLength(1);

    // The dropped chunk's decode must not write into the smaller buffer.
    reader.settle(1, 0);
    reader.settleAll(2);
    await vi.waitFor(() =>
      expect(image.getChunkStatuses()).toEqual(allLoaded(1))
    );

    expect(errors).toEqual([]);
    expect(sliceOf(image, 0)).toEqual(filledWith(2));

    image.dispose();
  });

  it('keeps the volume it has when a new membership cannot be allocated', async () => {
    const image = new DicomChunkImage({ readDicomImage });
    const [first, second] = await threeChunks();

    await image.setChunks([first], AXIAL);
    await vi.waitFor(() =>
      expect(image.getChunkStatuses()).toEqual(allLoaded(1))
    );
    const allocated = image.getVtkImageData();

    // A multi-frame instance cannot lead a multi-chunk volume, so allocation
    // rejects this membership.
    const multiFrame = await makeLoadedChunk(4, { [Tags.NumberOfFrames]: '2' });
    await expect(image.setChunks([multiFrame, second], AXIAL)).rejects.toThrow(
      /multi-frame/
    );

    expect(image.getChunks()).toEqual([first]);
    expect(image.getChunkStatuses()).toEqual(allLoaded(1));
    expect(image.getVtkImageData()).toBe(allocated);
    expect(sliceOf(image, 0)).toEqual(filledWith(1));

    image.dispose();
  });

  it('serializes overlapping calls so the last order wins', async () => {
    const image = new DicomChunkImage({ readDicomImage });
    const { chunk: gated, release } = makeGatedChunk(1);
    const loaded = await makeLoadedChunk(2);

    const first = image.setChunks([gated], AXIAL);
    const second = image.setChunks([loaded], AXIAL);

    // The first call is still waiting on its chunk's metadata.
    expect(image.getChunks()).toEqual([]);

    release();
    await Promise.all([first, second]);

    expect(image.getChunks()).toEqual([loaded]);
    await vi.waitFor(() =>
      expect(image.getChunkStatuses()).toEqual(allLoaded(1))
    );
    expect(sliceOf(image, 0)).toEqual(filledWith(2));

    image.dispose();
  });

  it('keeps a stale in-flight decode from clobbering the reordered volume', async () => {
    const { reader, image } = await imageWithReorderedChunk();
    let loads = 0;
    image.addEventListener('chunkLoad', () => {
      loads += 1;
    });

    // Complete the current decodes before the stale attempt.
    reader.settle(1, 0);
    reader.settle(2, 0);
    reader.settle(3, 1);
    await vi.waitFor(() => expect(loads).toBe(3));

    reader.settle(3, 0);
    await Promise.resolve();
    await Promise.resolve();
    expect(loads).toBe(3);

    expect(sliceOf(image, 0)).toEqual(filledWith(1));
    expect(sliceOf(image, 1)).toEqual(filledWith(2));
    expect(sliceOf(image, 2)).toEqual(filledWith(3));

    image.dispose();
  });

  it('does not let a stale success overwrite a replacement failure', async () => {
    const { reader, image, errors } = await imageWithReorderedChunk();

    reader.settle(1, 0);
    reader.settle(2, 0);
    await vi.waitFor(() =>
      expect(image.getChunkStatuses()[1]).toBe(ChunkStatus.Loaded)
    );

    // Fail the attempt for the current allocation.
    reader.settle(3, 1, new Error('replacement decode failed'));
    await vi.waitFor(() => expect(errors).toEqual([3]));

    expect(image.getChunkStatuses()).toEqual([
      ChunkStatus.Loaded,
      ChunkStatus.Loaded,
      ChunkStatus.Errored,
    ]);
    expect(sliceOf(image, 0)).toEqual(filledWith(1));

    // A late success from the previous allocation must be ignored.
    reader.settle(3, 0);
    await Promise.resolve();
    await Promise.resolve();
    expect(image.getChunkStatuses()[2]).toBe(ChunkStatus.Errored);
    expect(sliceOf(image, 2)).toEqual(filledWith(0));

    image.dispose();
  });

  it('does not let a stale failure overwrite a replacement success', async () => {
    const { reader, image, errors } = await imageWithReorderedChunk();

    reader.settle(1, 0);
    reader.settle(2, 0);
    reader.settle(3, 1);
    await vi.waitFor(() =>
      expect(image.getChunkStatuses()).toEqual(allLoaded(3))
    );

    // A late failure from the previous allocation must be ignored.
    reader.settle(3, 0, new Error('stale decode failed'));
    await Promise.resolve();
    await Promise.resolve();
    expect(errors).toEqual([]);
    expect(image.getChunkStatuses()[2]).toBe(ChunkStatus.Loaded);
    expect(sliceOf(image, 2)).toEqual(filledWith(3));

    image.dispose();
  });

  it('reports a reallocated chunk as loading until its slice is rewritten', async () => {
    const reader = deferredReader();
    const image = new DicomChunkImage({ readDicomImage: reader.read });

    const [first, second] = await threeChunks();

    await image.setChunks([first], AXIAL);
    await vi.waitFor(() => expect(reader.total()).toBe(1));
    reader.settle(1, 0);
    await vi.waitFor(() => expect(image.status.value).toBe('complete'));

    // Reallocation cleared chunk 1, and neither replacement decode has run.
    await image.setChunks([first, second], AXIAL);

    expect(image.getChunkStatuses()).toEqual([
      ChunkStatus.Loading,
      ChunkStatus.Loading,
    ]);
    expect(image.status.value).toBe('incomplete');
    expect(sliceOf(image, 0)).toEqual(filledWith(0));

    await vi.waitFor(() => expect(reader.total()).toBe(3));
    reader.settle(1, 1);
    reader.settleAll(2);
    await vi.waitFor(() => expect(image.status.value).toBe('complete'));
    expect(sliceOf(image, 0)).toEqual(filledWith(1));
    expect(sliceOf(image, 1)).toEqual(filledWith(2));

    image.dispose();
  });

  it('thumbnails the middle slice out of the volume buffer', async () => {
    const reader = countingReader(readDicomImage);
    const { image, encoder } = await thumbnailFixture(reader.read);
    await vi.waitFor(() =>
      expect(image.getChunkStatuses()).toEqual(allLoaded(3))
    );
    const decodes = reader.files.length;

    const uri = await image.getThumbnail();

    // Reading the buffer means no second decode of the middle chunk.
    expect(reader.files).toHaveLength(decodes);
    expect(encoder.slices).toHaveLength(1);
    expect(encoder.slices[0]).toEqual(
      sliceToThumbnail({
        data: sliceOf(image, 1),
        width: COLUMNS,
        height: ROWS,
        range: scalarRange(image),
      })
    );
    expect(uri).toBe(`uri:${Array.from(encoder.slices[0].data).join(',')}`);

    image.dispose();
  });

  it('windows a multi component thumbnail on the component it reads', async () => {
    const OTHER_COMPONENT = 1000;
    const readRgbImage: DicomChunkImageInit['readDicomImage'] = async (
      file
    ) => {
      const value = Number(await file.text()) * 100;
      return {
        image: {
          size: [COLUMNS, ROWS, 1],
          data: Uint16Array.from(
            { length: PIXELS_PER_SLICE * 3 },
            (_, index) => (index % 3 === 0 ? value : OTHER_COMPONENT)
          ),
          imageType: { components: 3 },
        },
      };
    };

    const encoder = capturingEncoder();
    const image = new DicomChunkImage({
      readDicomImage: readRgbImage,
      encodeThumbnail: encoder.encodeThumbnail,
    });
    const chunks = await Promise.all(
      [1, 2, 3].map((z) => makeLoadedChunk(z, { [Tags.SamplesPerPixel]: '3' }))
    );

    await image.setChunks(chunks, AXIAL);
    await vi.waitFor(() =>
      expect(image.getChunkStatuses()).toEqual(allLoaded(3))
    );

    await image.getThumbnail();

    // Component 0 runs 100 to 300 across the volume, so the middle slice's 200
    // is mid grey. The vector magnitude range would clamp it to black.
    expect(Array.from(encoder.slices[0].data)).toEqual([128, 128, 128, 128]);

    image.dispose();
  });

  it('thumbnails the new middle slice after its membership changes', async () => {
    const { image, encoder, chunks } = await thumbnailFixture();
    const [first, , third] = chunks;
    await vi.waitFor(() =>
      expect(image.getChunkStatuses()).toEqual(allLoaded(3))
    );
    await image.getThumbnail();

    await image.setChunks([first, third], AXIAL);
    await vi.waitFor(() =>
      expect(image.getChunkStatuses()).toEqual(allLoaded(2))
    );
    await image.getThumbnail();

    expect(encoder.slices).toHaveLength(2);
    expect(encoder.slices[1]).toEqual(
      sliceToThumbnail({
        data: sliceOf(image, 1),
        width: COLUMNS,
        height: ROWS,
        range: scalarRange(image),
      })
    );

    image.dispose();
  });

  it('thumbnails from the chunk itself before its slice is decoded', async () => {
    const reader = deferredReader();
    const { image, encoder } = await thumbnailFixture(reader.read);
    await vi.waitFor(() => expect(reader.countFor(2)).toBe(1));
    expect(image.getChunkStatuses()[1]).not.toBe(ChunkStatus.Loaded);

    const thumbnail = image.getThumbnail();
    // The middle chunk's own bytes are decoded for the thumbnail.
    await vi.waitFor(() => expect(reader.countFor(2)).toBe(2));
    reader.settleAll(2);

    expect(await thumbnail).toBe(
      `uri:${Array.from(encoder.slices[0].data).join(',')}`
    );
    expect(encoder.slices[0].width).toBe(COLUMNS);
    expect(encoder.slices[0].height).toBe(ROWS);
    const decoded = await Promise.all(reader.files.map((f) => f.text()));
    expect(decoded.sort()).toEqual(['1', '2', '2', '3']);

    image.dispose();
  });

  it('decodes the middle chunk once for every thumbnail asked before its slot is filled', async () => {
    const reader = deferredReader();
    const { image, encoder } = await thumbnailFixture(reader.read);
    await vi.waitFor(() => expect(reader.countFor(2)).toBe(1));

    // The volume browser asks again on every change to the volume list.
    const first = image.getThumbnail();
    const second = image.getThumbnail();
    await vi.waitFor(() => expect(reader.countFor(2)).toBe(2));
    await Promise.resolve();
    expect(reader.countFor(2)).toBe(2);
    reader.settleAll(2);

    expect(await first).toBe(await second);
    expect(encoder.slices).toHaveLength(1);

    image.dispose();
  });

  it('forgets a thumbnail when its membership changes', async () => {
    const { image, encoder, chunks } = await thumbnailFixture();
    const [first, , third] = chunks;
    await vi.waitFor(() =>
      expect(image.getChunkStatuses()).toEqual(allLoaded(3))
    );
    const before = await image.getThumbnail();
    expect(await image.getThumbnail()).toBe(before);

    await image.setChunks([first, third], AXIAL);
    await vi.waitFor(() =>
      expect(image.getChunkStatuses()).toEqual(allLoaded(2))
    );

    expect(await image.getThumbnail()).not.toBe(before);
    expect(encoder.slices).toHaveLength(2);

    image.dispose();
  });

  it('rejects the thumbnail when the middle chunk fails to load instead of waiting', async () => {
    const image = new DicomChunkImage({ readDicomImage });
    const chunk = new Chunk({
      metaLoader: {
        meta: metadataFor(1),
        metaBlob: null,
        load: () => {},
        stop: () => {},
      },
      dataLoader: {
        data: null,
        load: () => Promise.reject(new Error('no bytes for this slice')),
        stop: () => {},
      },
    });
    await chunk.loadMeta();
    await image.setChunks([chunk], AXIAL);

    const thumbnail = image.getThumbnail();
    await chunk.loadData().catch(() => {});

    await expect(thumbnail).rejects.toThrow('no bytes for this slice');
    await vi.waitFor(() =>
      expect(image.getChunkStatuses()).toEqual([ChunkStatus.Errored])
    );

    image.dispose();
  });
});
