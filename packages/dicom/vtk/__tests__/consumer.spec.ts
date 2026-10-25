import { sliceFromChunk } from '../thumbnailSource';
import { describe, expect, it } from 'vitest';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import { Chunk, type Reconstruction } from '../../core';
import { VtkDicomImage, type VtkDicomImageInit } from '..';
import { datasetFromTags } from '@/tests/dicomDataset';

const AXIAL = [1, 0, 0, 0, 1, 0];

async function loadedChunk(value: number, modality = 'CT') {
  const metadata = datasetFromTags(
    Object.entries({
      '00080060': modality,
      '00080018': `1.2.3.${value}`,
      '00200032': `0\\0\\${value}`,
      '00200037': '1\\0\\0\\0\\1\\0',
      '00280010': '1',
      '00280011': '1',
      '00280030': '1\\1',
      '00280101': '16',
      '00280103': '0',
    })
  );
  const chunk = new Chunk({
    metaLoader: { meta: metadata, load() {}, stop() {} },
    dataLoader: { data: new Blob([String(value)]), load() {}, stop() {} },
  });
  await chunk.loadMeta();
  await chunk.loadData();
  return chunk;
}

const decoded = (value: number) => ({
  image: {
    size: [1, 1, 1],
    data: new Uint16Array([value]),
    imageType: { components: 1 },
  },
});

const read: VtkDicomImageInit['readDicomImage'] = async (file) =>
  decoded(Number(await file.text()));
const pixels = (image: VtkDicomImage) =>
  Array.from(image.getVtkImageData().getPointData().getScalars().getData());

function completed(image: VtkDicomImage) {
  return new Promise<void>((resolve) => {
    const listener = (status: string) => {
      if (status !== 'complete') return;
      image.removeEventListener('status', listener);
      resolve();
    };
    image.addEventListener('status', listener);
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('vtk DICOM consumer', () => {
  it('uses the plan spacing and slice mapping without reconstructing it', async () => {
    const chunks = await Promise.all([loadedChunk(1), loadedChunk(19)]);
    const image = new VtkDicomImage({ readDicomImage: read });
    const reconstruction: Reconstruction = {
      kind: 'regular',
      sliceSpacing: 9,
      slots: [0, 2],
    };
    const done = completed(image);
    await image.setChunks(chunks, AXIAL, reconstruction);
    reconstruction.slots[1] = 0;
    await done;
    expect(image.getVtkImageData().getDimensions()).toEqual([1, 1, 3]);
    expect(image.getVtkImageData().getSpacing()).toEqual([1, 1, 9]);
    expect(pixels(image)).toEqual([1, 0, 19]);
    image.dispose();
  });

  it('can reject irregular geometry before replacing an existing image', async () => {
    const chunk = await loadedChunk(1);
    const image = new VtkDicomImage({
      readDicomImage: read,
      irregularGeometry: 'reject',
    });
    const done = completed(image);
    await image.setChunks([chunk], AXIAL);
    await done;
    const original = image.getVtkImageData();
    await expect(
      image.setChunks([chunk], AXIAL, {
        kind: 'irregular',
        reason: 'in-plane-shift',
        sliceSpacing: 5,
        slots: [0],
      })
    ).rejects.toThrow('in-plane-shift');
    expect(image.getVtkImageData()).toBe(original);
    expect(pixels(image)).toEqual([1]);
    image.dispose();
  });

  it('rejects a nonzero first slice slot before replacing an existing image', async () => {
    const chunk = await loadedChunk(1);
    const chunks = await Promise.all([loadedChunk(10), loadedChunk(20)]);
    const image = new VtkDicomImage({ readDicomImage: read });
    const done = completed(image);
    await image.setChunks([chunk], AXIAL);
    await done;
    const original = image.getVtkImageData();

    await expect(
      image.setChunks(chunks, AXIAL, {
        kind: 'regular',
        sliceSpacing: 10,
        slots: [1, 2],
      })
    ).rejects.toThrow('slice slot');

    expect(image.getVtkImageData()).toBe(original);
    expect(original.getOrigin()).toEqual([0, 0, 1]);
    expect(pixels(image)).toEqual([1]);

    const updated = completed(image);
    await image.setChunks(chunks, AXIAL, {
      kind: 'regular',
      sliceSpacing: 10,
      slots: [0, 1],
    });
    await updated;
    expect(image.getVtkImageData().getOrigin()).toEqual([0, 0, 10]);
    expect(pixels(image)).toEqual([10, 20]);
    image.dispose();
  });

  it('restarts decoding after cancellation and ignores the cancelled result', async () => {
    const chunk = await loadedChunk(1);
    const first = deferred<ReturnType<typeof decoded>>();
    const second = deferred<ReturnType<typeof decoded>>();
    let calls = 0;
    const image = new VtkDicomImage({
      readDicomImage: () => (++calls === 1 ? first.promise : second.promise),
    });
    const delivered: number[][] = [];
    image.addEventListener('chunkLoad', () => delivered.push(pixels(image)));
    await image.setChunks([chunk], AXIAL);
    image.stopLoad();
    image.startLoad();
    const done = completed(image);
    first.resolve(decoded(99));
    second.resolve(decoded(2));
    await done;
    expect(delivered).toEqual([[2]]);
    expect(pixels(image)).toEqual([2]);
    image.dispose();
  });

  it('rejects incomplete pixel buffers and retries without reallocating', async () => {
    const chunk = await loadedChunk(1);
    let calls = 0;
    const image = new VtkDicomImage({
      readDicomImage: async () => {
        calls += 1;
        return calls === 1
          ? { image: { ...decoded(1).image, data: new Uint16Array() } }
          : decoded(3);
      },
    });
    const failed = new Promise<unknown>((resolve) =>
      image.addEventListener('chunkError', ({ error }) => resolve(error))
    );
    await image.setChunks([chunk], AXIAL);
    expect(String(await failed)).toContain('decoded 0 samples; expected 1');
    const original = image.getVtkImageData();
    const done = completed(image);
    image.startLoad();
    await done;
    expect(image.getVtkImageData()).toBe(original);
    expect(pixels(image)).toEqual([3]);
    image.dispose();
  });

  it.each(['waiting for bytes', 'decoding pixels'])(
    'settles a thumbnail on disposal while %s',
    async (phase) => {
      const chunk = await loadedChunk(1);
      if (phase === 'waiting for bytes') {
        chunk.dispose();
      }
      const pendingDecode = deferred<ReturnType<typeof decoded>>();
      const source =
        phase === 'waiting for bytes'
          ? new Chunk({
              metaLoader: { meta: chunk.metadata, load() {}, stop() {} },
              dataLoader: { data: null, load() {}, stop() {} },
            })
          : chunk;
      const image = new VtkDicomImage({
        readDicomImage: () => pendingDecode.promise,
      });
      await image.setChunks([source], AXIAL);
      const thumbnail = image.getThumbnail();
      image.dispose();
      await expect(thumbnail).rejects.toMatchObject({ name: 'AbortError' });
      pendingDecode.resolve(decoded(1));
    }
  );

  it('deletes segmentation images returned after disposal', async () => {
    const chunk = await loadedChunk(1, 'SEG');
    const result = deferred<{ image: vtkImageData; metadata: unknown }>();
    const image = new VtkDicomImage({
      readDicomImage: read,
      readSegmentation: () => result.promise,
    });
    await image.setChunks([chunk], AXIAL);
    image.dispose();
    const stale = vtkImageData.newInstance();
    let signalDeleted = () => {};
    const deleted = new Promise<void>((resolve) => {
      signalDeleted = resolve;
    });
    result.resolve({
      image: {
        ...stale,
        delete() {
          stale.delete();
          signalDeleted();
        },
      },
      metadata: null,
    });
    await deleted;
    expect(stale.isDeleted()).toBe(true);
    expect(chunk.dataBlob).toBeInstanceOf(Blob);
  });
});

describe('consumer failure recovery', () => {
  it.each([
    { size: [2, 1, 1], components: 1, count: 1, error: 'does not fit' },
    { size: [1, 1, 1], components: 2, count: 1, error: 'does not fit' },
    { size: [1, 1, 2], components: 1, count: 2, error: 'multiple frames' },
  ])(
    'rejects decoded slot shape $size with $components components',
    async ({ size, components, count, error }) => {
      const chunks = await Promise.all(
        Array.from({ length: count }, (_, i) => loadedChunk(i))
      );
      const image = new VtkDicomImage({
        readDicomImage: async () => ({
          image: {
            size,
            data: new Uint16Array(size.reduce((n, v) => n * v, components)),
            imageType: { components },
          },
        }),
      });
      const failed = new Promise<unknown>((resolve) =>
        image.addEventListener('chunkError', ({ error: err }) => resolve(err))
      );
      await image.setChunks(chunks, AXIAL);
      expect(String(await failed)).toContain(error);
      expect(pixels(image).every((value) => value === 0)).toBe(true);
      image.dispose();
    }
  );

  it('retries an idle failed middle chunk when a thumbnail is requested', async () => {
    const metadata = (await loadedChunk(5)).metadata;
    const data = {
      data: null as Blob | null,
      load() {
        if (!this.data) {
          this.data = new Blob(['5']);
          throw new Error('offline');
        }
      },
      stop() {},
    };
    const chunk = new Chunk({
      metaLoader: { meta: metadata, load() {}, stop() {} },
      dataLoader: data,
    });
    await chunk.loadMeta();
    await expect(chunk.loadData()).rejects.toThrow('offline');
    expect(
      await sliceFromChunk(chunk, read, new AbortController().signal)
    ).toMatchObject({ width: 1, height: 1 });
    chunk.dispose();
  });

  it('fulfills a thumbnail invalidated by a replacement allocation', async () => {
    const firstDecode = deferred<ReturnType<typeof decoded>>();
    const pendingThumbnail = deferred<ReturnType<typeof decoded>>();
    const thumbnailStarted = deferred<void>();
    let thumbnailCalls = 0;
    const image = new VtkDicomImage({
      readDicomImage: async (file) => {
        if (file.name === 'thumbnail.dcm') {
          if (++thumbnailCalls === 1) {
            thumbnailStarted.resolve();
            return pendingThumbnail.promise;
          }
          return decoded(2);
        }
        return firstDecode.promise;
      },
      encodeThumbnail: () => 'current-thumbnail',
    });
    const a = await loadedChunk(1);
    const b = await loadedChunk(2);
    await image.setChunks([a], AXIAL);
    const thumbnail = image.getThumbnail();
    await thumbnailStarted.promise;
    await image.setChunks([a, b], AXIAL);
    await expect(thumbnail).resolves.toBe('current-thumbnail');
    image.dispose();
    firstDecode.resolve(decoded(1));
    pendingThumbnail.resolve(decoded(1));
  });
});
