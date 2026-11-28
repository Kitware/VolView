import { afterEach, describe, expect, it, vi } from 'vitest';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import { datasetFromTags, instanceFor } from '@/tests/dicomDataset';
import {
  allocateVolume,
  type Volume,
} from '@/src/dicom/core/volume/allocateVolume';
import {
  createDicomRuntime,
  type DicomRuntime,
} from '@/src/dicom/core/runtime/createDicomRuntime';
import { fromBlob, type ByteSource } from '@/src/dicom/core/source/byteSource';
import {
  readInstance,
  type Instance,
} from '@/src/dicom/core/instance/readInstance';
import { Tags } from '@/src/dicom/core/metadata/dicomTags';
import type {
  DecodedPixels,
  WholeInstanceDecode,
} from '@/src/dicom/core/pixels/pixelDecoder';
import type { Extent } from '@/src/dicom/core/volume/loadVolume';
import { decodingWith, plannedUpdate } from '@/tests/dicomVolumeFixtures';
import { sliceThumbnail } from '@/src/dicom/vtk/volumeImage';
import type { ThumbnailSlice } from '@/src/dicom/vtk/thumbnail';
import { defer } from '@/src/utils';
import { nativePixelDicom } from '@/tests/nativePixelDicom';
import DicomVolumeImage, {
  type DicomVolumeImageInit,
} from '@/src/core/streaming/dicomVolumeImage';

const ROWS = 2;
const COLUMNS = 2;
const PIXELS_PER_SLICE = ROWS * COLUMNS;

// The slice's z position is also its pixel value, so decoded contents say
// which instance a slice came from.
function sliceAt(z: number, overrides: Record<string, string> = {}) {
  const tags = new Map([
    [Tags.SOPInstanceUID, `1.2.3.${z}`],
    [Tags.SeriesInstanceUID, '1.2.3'],
    [Tags.ImagePositionPatient, `0\\0\\${z}`],
    [Tags.ImageOrientationPatient, '1\\0\\0\\0\\1\\0'],
    [Tags.Rows, String(ROWS)],
    [Tags.Columns, String(COLUMNS)],
    [Tags.PixelSpacing, '1\\1'],
    [Tags.BitsStored, '16'],
    [Tags.PixelRepresentation, '0'],
    [Tags.SamplesPerPixel, '1'],
    ...Object.entries(overrides),
  ]);
  return instanceFor(datasetFromTags(tags), fromBlob(new Blob([String(z)])));
}

const volumeOf = (members: Instance[], previous?: Volume) =>
  allocateVolume(plannedUpdate(members), previous);

const stack = (count: number) =>
  volumeOf(Array.from({ length: count }, (_, z) => sliceAt(z)));

/** Decodes a source written by `sliceAt`, recording the values it decodes. */
function decodeTo(
  dataFor: (value: number) => ArrayLike<number>,
  components = 1
) {
  const decoded: number[] = [];
  const decoder: WholeInstanceDecode = async ({ bytes }) => {
    const value = Number(new TextDecoder().decode(bytes));
    decoded.push(value);
    return {
      size: [COLUMNS, ROWS, 1],
      data: dataFor(value) as DecodedPixels['data'],
      components,
    };
  };
  return { decoded, decoder };
}

const constantSlices = () =>
  decodeTo((value) => new Uint16Array(PIXELS_PER_SLICE).fill(value));

const runtimes: DicomRuntime[] = [];
const images: DicomVolumeImage[] = [];
afterEach(() => {
  images.splice(0).forEach((image) => image.dispose());
  runtimes.splice(0).forEach((runtime) => runtime.dispose());
});

function holder(
  decoder: WholeInstanceDecode,
  init: Omit<DicomVolumeImageInit, 'runtime'> = {},
  readConcurrency?: number
) {
  const runtime = createDicomRuntime({
    ...decodingWith(decoder),
    decodeConcurrency: 1,
  });
  runtimes.push(runtime);
  const encoded: ThumbnailSlice[] = [];
  const image = new DicomVolumeImage({
    runtime: {
      ...runtime,
      readConcurrency: readConcurrency ?? runtime.readConcurrency,
    },
    encodeThumbnail: (slice) => {
      encoded.push(slice);
      return `uri:${Array.from(slice.data).join(',')}`;
    },
    ...init,
  });
  images.push(image);
  const extents: Extent[] = [];
  const errors: Error[] = [];
  image.addEventListener('extentLoaded', (extent) => extents.push(extent));
  image.addEventListener('error', (error) => errors.push(error));
  return { image, encoded, extents, errors };
}

/** Resolves once the image is no longer loading. */
const idle = (image: DicomVolumeImage) =>
  new Promise<void>((resolve) => {
    if (!image.isLoading()) {
      resolve();
      return;
    }
    const done = (loading: boolean) => {
      if (loading) return;
      image.removeEventListener('loading', done);
      resolve();
    };
    image.addEventListener('loading', done);
  });

async function show(image: DicomVolumeImage, volume: Volume) {
  image.setVolume(volume);
  image.startLoad();
  await idle(image);
}

function sliceOf(image: DicomVolumeImage, index: number) {
  const data = image.getVtkImageData().getPointData().getScalars().getData();
  return Array.from(
    data.slice(index * PIXELS_PER_SLICE, (index + 1) * PIXELS_PER_SLICE)
  );
}

const scalarRange = (image: DicomVolumeImage) =>
  image.getVtkImageData().getPointData().getScalars().getRange() as [
    number,
    number,
  ];

const filledWith = (value: number) => Array(PIXELS_PER_SLICE).fill(value);

const thumbnailOf = (image: DicomVolumeImage, slice: number) =>
  sliceThumbnail(image.getVtkImageData(), slice);

describe('DicomVolumeImage loading', () => {
  it('fills every slice, reporting each decoded extent, then completes', async () => {
    const { decoder } = constantSlices();
    const { image, extents } = holder(decoder);
    const statuses: string[] = [];
    image.addEventListener('status', (status) => statuses.push(status));

    image.setVolume(stack(3));
    image.startLoad();
    expect(image.isLoading()).toBe(true);
    expect(image.isLoaded()).toBe(false);
    await idle(image);

    expect(image.isLoaded()).toBe(true);
    expect(statuses).toEqual(['complete']);
    expect([0, 1, 2].map((slice) => sliceOf(image, slice))).toEqual([
      filledWith(0),
      filledWith(1),
      filledWith(2),
    ]);
    expect([...extents].sort((left, right) => left[4] - right[4])).toEqual([
      [0, 1, 0, 1, 0, 0],
      [0, 1, 0, 1, 1, 1],
      [0, 1, 0, 1, 2, 2],
    ]);
    expect(scalarRange(image)).toEqual([0, 2]);
  });

  it('reports nothing loading when started with every slice already loaded', async () => {
    const { decoder, decoded } = constantSlices();
    const { image } = holder(decoder);
    await show(image, stack(2));

    image.startLoad();

    expect(image.isLoading()).toBe(false);
    expect(image.isLoaded()).toBe(true);
    expect(decoded).toHaveLength(2);
  });

  it('loads the slice the user looks at first', async () => {
    const { decoder, decoded } = constantSlices();
    // One request at a time, so decode order is read order.
    const { image } = holder(decoder, { focus: () => 7 }, 1);

    await show(image, stack(9));

    expect(decoded).toEqual([7, 3, 5, 1, 6, 8, 4, 2, 0]);
  });
});

/** Lets pending reads and decodes run, without the timers a test has faked. */
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

async function until(met: () => boolean) {
  while (!met()) await turn();
}

describe('DicomVolumeImage announcements', () => {
  afterEach(() => vi.useRealTimers());

  const SLICES = 4;

  /**
   * A load whose last decode is held, so it cannot finish and announce
   * itself, at the point where every other slice has decoded, or failed to
   * when `failFirst`, and waits for the timer. Later decodes wait for the
   * same release.
   */
  async function heldLoad({ failFirst = false } = {}) {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const last = defer<void>();
    const { decoder } = constantSlices();
    let decodes = 0;
    const held = holder(async (request, signal) => {
      decodes += 1;
      if (failFirst && decodes === 1) throw new Error('corrupt');
      if (decodes >= SLICES) await last.promise;
      return decoder(request, signal);
    });
    const statuses: string[] = [];
    held.image.addEventListener('status', (status) => statuses.push(status));
    const volume = stack(SLICES);
    held.image.setVolume(volume);
    held.image.startLoad();
    // The failure is yielded ahead of the slices that decode after it.
    const decoded = SLICES - 1 - (failFirst ? 1 : 0);
    await until(
      () => volume.loaded.filter((isLoaded) => isLoaded).length === decoded
    );
    return { ...held, statuses, release: () => last.resolve() };
  }

  const slicesOf = (extents: Extent[]) =>
    extents.map((extent) => extent[4]).sort();

  it('announces slices that decode between two timer ticks together', async () => {
    const { image, extents, statuses, release } = await heldLoad();

    expect(extents).toEqual([]);
    vi.runOnlyPendingTimers();
    expect(extents).toHaveLength(SLICES - 1);
    expect(image.isLoaded()).toBe(false);

    release();
    await idle(image);

    expect(slicesOf(extents)).toEqual([0, 1, 2, 3]);
    expect(image.isLoaded()).toBe(true);
    expect(statuses).toEqual(['complete']);
    expect(scalarRange(image)).toEqual([0, 3]);
  });

  it('announces slices decoded before a stop, which the next load does not decode again', async () => {
    const { image, extents, release } = await heldLoad();

    image.stopLoad();
    image.startLoad();
    release();
    await idle(image);

    expect(slicesOf(extents)).toEqual([0, 1, 2, 3]);
    expect(scalarRange(image)).toEqual([0, 3]);
    expect(image.isLoaded()).toBe(true);
  });

  it('drops the slices and errors a replaced volume had yet to announce', async () => {
    const { image, extents, errors, release } = await heldLoad({
      failFirst: true,
    });

    image.setVolume(volumeOf([sliceAt(7), sliceAt(8)]));
    vi.runOnlyPendingTimers();
    await turn();
    expect({ extents, errors }).toEqual({ extents: [], errors: [] });

    image.startLoad();
    release();
    await idle(image);

    expect(errors).toEqual([]);
    expect(slicesOf(extents)).toEqual([0, 1]);
    expect([0, 1].map((slice) => sliceOf(image, slice))).toEqual([
      filledWith(7),
      filledWith(8),
    ]);
    expect(scalarRange(image)).toEqual([7, 8]);
    expect(image.isLoaded()).toBe(true);
  });
});

describe('DicomVolumeImage failures', () => {
  it('settles after rejecting decoded values its integer buffer cannot hold', async () => {
    const { decoder } = decodeTo((value) =>
      value === 2
        ? new Uint16Array(PIXELS_PER_SLICE).fill(5000)
        : new Uint8Array(PIXELS_PER_SLICE).fill(value)
    );
    const { image, errors } = holder(decoder);
    const eightBit = { [Tags.BitsStored]: '8' };

    await show(image, volumeOf([sliceAt(1, eightBit), sliceAt(2, eightBit)]));

    expect(image.status.value).toBe('complete');
    expect(sliceOf(image, 0)).toEqual(filledWith(1));
    expect(sliceOf(image, 1)).toEqual(filledWith(0));
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('5000');
    expect(errors[0].message).toContain('Uint8Array');
  });

  it('settles once every frame of a multiframe instance loaded or failed', async () => {
    const file = fromBlob(
      new Blob([nativePixelDicom({ rows: ROWS, columns: COLUMNS, frames: 3 })])
    );
    let frameReads = 0;
    // The second frame read fails; the header and other frames read normally.
    const source: ByteSource = {
      read: (signal, range) =>
        range && ++frameReads === 2
          ? new ReadableStream({
              pull: (controller) => controller.error(new Error('reset')),
            })
          : file.read(signal, range),
    };
    const instance = await readInstance(source, new AbortController().signal);
    const runtime = createDicomRuntime({});
    runtimes.push(runtime);
    const image = new DicomVolumeImage({ runtime });
    images.push(image);
    const errors: Error[] = [];
    image.addEventListener('error', (error) => errors.push(error));

    await show(image, volumeOf([instance]));

    expect(errors.map(({ message }) => message)).toEqual([
      expect.stringMatching(/frame 0 could not be read: reset$/),
    ]);
    expect(image.isLoading()).toBe(false);
    expect(image.isLoaded()).toBe(true);
  });

  it('retries a failed slice on the next load', async () => {
    let failures = 1;
    const { decoder, decoded } = constantSlices();
    const { image, errors } = holder(async (request, signal) => {
      const slice = await decoder(request, signal);
      if (slice.data[0] === 1 && failures-- > 0)
        throw new Error('corrupt slice');
      return slice;
    });
    await show(image, stack(3));
    expect(errors.map(({ message }) => message)).toEqual([
      expect.stringMatching(/could not be decoded: corrupt slice$/),
    ]);
    expect(sliceOf(image, 1)).toEqual(filledWith(0));

    image.startLoad();
    await idle(image);

    expect(sliceOf(image, 1)).toEqual(filledWith(1));
    expect(decoded.filter((value) => value !== 1)).toHaveLength(2);
    expect(image.isLoaded()).toBe(true);
  });
});

describe('DicomVolumeImage replacement', () => {
  it('keeps decoded slices across growth without decoding them again', async () => {
    const { decoder, decoded } = constantSlices();
    const { image } = holder(decoder);
    const [first, middle, last] = [0, 1, 2].map((z) => sliceAt(z));
    const sparse = volumeOf([first, last]);
    await show(image, sparse);
    const before = image.getVtkImageData();
    decoded.length = 0;

    await show(image, volumeOf([first, middle, last], sparse));

    expect(image.getVtkImageData()).not.toBe(before);
    expect(decoded).toEqual([1]);
    expect([0, 1, 2].map((slice) => sliceOf(image, slice))).toEqual([
      filledWith(0),
      filledWith(1),
      filledWith(2),
    ]);
    expect(scalarRange(image)).toEqual([0, 2]);
  });

  it('keeps a decode started for a replaced volume out of its successor', async () => {
    const release = defer<void>();
    const { decoder } = constantSlices();
    const { image, extents } = holder(async (request, signal) => {
      await release.promise;
      return decoder(request, signal);
    });
    image.setVolume(volumeOf([sliceAt(5)]));
    image.startLoad();

    image.setVolume(volumeOf([sliceAt(7)]));
    image.startLoad();
    release.resolve();
    await idle(image);

    expect(sliceOf(image, 0)).toEqual(filledWith(7));
    expect(extents).toHaveLength(1);
  });

  it('aborts loading when disposed', async () => {
    const started = defer<AbortSignal>();
    const { image } = holder((_request, signal) => {
      started.resolve(signal);
      return new Promise(() => {});
    });
    image.setVolume(stack(1));
    image.startLoad();
    const signal = await started.promise;

    image.dispose();

    expect(signal.aborted).toBe(true);
    await expect(image.getThumbnail()).rejects.toThrow(/disposed/);
  });
});

describe('DicomVolumeImage thumbnails', () => {
  it('thumbnails the middle slice out of the loaded volume', async () => {
    const { decoder, decoded } = constantSlices();
    const { image, encoded } = holder(decoder);
    await show(image, stack(3));

    const uri = await image.getThumbnail();

    expect(decoded).toHaveLength(3);
    expect(encoded).toEqual([thumbnailOf(image, 1)]);
    expect(uri).toBe(`uri:${Array.from(encoded[0].data).join(',')}`);
  });

  it('waits for the middle slice when asked before it loads, encoding once', async () => {
    const { decoder, decoded } = constantSlices();
    const { image, encoded } = holder(decoder);
    image.setVolume(stack(3));

    const first = image.getThumbnail();
    const second = image.getThumbnail();
    image.startLoad();

    expect(await first).toBe(await second);
    await idle(image);
    expect(decoded).toHaveLength(3);
    expect(encoded).toHaveLength(1);
  });

  it('falls back to the loaded slice nearest the middle when the middle fails', async () => {
    const { decoder } = constantSlices();
    const { image, encoded } = holder(async (request, signal) => {
      const slice = await decoder(request, signal);
      if (slice.data[0] === 1) throw new Error('corrupt middle slice');
      return slice;
    });
    await show(image, stack(3));

    await image.getThumbnail();

    expect(encoded).toEqual([thumbnailOf(image, 0)]);
  });

  it('has no thumbnail when no slice loads', async () => {
    const { image, encoded } = holder(async () => {
      throw new Error('undecodable');
    });
    await show(image, stack(2));

    expect(await image.getThumbnail()).toBeNull();
    expect(encoded).toEqual([]);
  });

  it('thumbnails a volume whose retry loads after every slice failed', async () => {
    let failing = true;
    const { decoder } = constantSlices();
    const { image, encoded } = holder(async (request, signal) => {
      if (failing) throw new Error('server down');
      return decoder(request, signal);
    });
    await show(image, stack(3));
    expect(await image.getThumbnail()).toBeNull();

    failing = false;
    image.startLoad();
    await idle(image);

    expect(await image.getThumbnail()).not.toBeNull();
    expect(encoded).toEqual([thumbnailOf(image, 1)]);
  });

  it('thumbnails the new middle slice after the volume changes', async () => {
    const { decoder } = constantSlices();
    const { image, encoded } = holder(decoder);
    const slices = [0, 1, 2].map((z) => sliceAt(z));
    const full = volumeOf(slices);
    await show(image, full);
    const before = await image.getThumbnail();

    await show(image, volumeOf([slices[0], slices[2]], full));

    expect(await image.getThumbnail()).not.toBe(before);
    expect(encoded).toHaveLength(2);
    expect(encoded[1]).toEqual(thumbnailOf(image, 1));
  });
});

describe('DicomVolumeImage segmentation', () => {
  const segInstance = (bytes = 'seg-bytes') =>
    instanceFor(
      datasetFromTags([
        [Tags.Modality, 'SEG'],
        [Tags.SOPInstanceUID, '1.2.3.9'],
      ]),
      fromBlob(new Blob([bytes]))
    );

  it('shows the labelmap the segmentation reader makes of its bytes', async () => {
    const labelmap = vtkImageData.newInstance();
    const metadata = { segmentAttributes: [] };
    const read: string[] = [];
    const { image } = holder(constantSlices().decoder, {
      readSegmentation: async (file) => {
        read.push(await file.text());
        return {
          image: labelmap,
          metadata: metadata as unknown as NonNullable<
            DicomVolumeImage['segBuildInfo']
          >,
        };
      },
    });

    image.setSegmentation([segInstance()]);
    image.startLoad();
    await idle(image);

    expect(read).toEqual(['seg-bytes']);
    expect(image.getVtkImageData()).toBe(labelmap);
    expect(image.segBuildInfo).toBe(metadata);
    expect(image.getModality()).toBe('SEG');
    expect(image.isLoaded()).toBe(true);
  });

  it('reports a SEG object split over several files', async () => {
    const { image, errors } = holder(constantSlices().decoder);

    image.setSegmentation([segInstance('a'), segInstance('b')]);
    image.startLoad();
    await idle(image);

    expect(errors.map(({ message }) => message)).toEqual([
      expect.stringMatching(/multiple SEG files/),
    ]);
    expect(image.isLoaded()).toBe(false);
  });

  it('has no thumbnail when the segmentation reader fails', async () => {
    const { image } = holder(constantSlices().decoder, {
      readSegmentation: async () => {
        throw new Error('unreadable SEG');
      },
    });

    image.setSegmentation([segInstance()]);
    const thumbnail = image.getThumbnail();
    image.startLoad();

    expect(await thumbnail).toBeNull();
  });
});
