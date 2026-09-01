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

function sliceOf(image: DicomChunkImage, index: number) {
  const scalars = image.getVtkImageData().getPointData().getScalars();
  const data = scalars.getData();
  return Array.from(
    data.slice(index * PIXELS_PER_SLICE, (index + 1) * PIXELS_PER_SLICE)
  );
}

async function loadRejectingSeries(
  readDicomImage: DicomChunkImageInit['readDicomImage']
) {
  const image = new DicomChunkImage({
    splitAndSort: splitAndSortByPosition,
    readDicomImage,
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
});
