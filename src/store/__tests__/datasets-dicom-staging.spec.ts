import { beforeEach, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { createDicomLoader } from '@/packages/dicom/core/runtime/createDicomLoader';
import DicomChunkImage from '@/src/core/streaming/dicomChunkImage';
import { useDICOMStore } from '@/src/store/datasets-dicom';
import { useImageCacheStore } from '@/src/store/image-cache';
import { syntheticSlice } from '@/tests/dicomSourceFixtures';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

beforeEach(() => setActivePinia(createPinia()));

it('keeps the displayed volume intact while growth prepares and a sibling fails', async () => {
  const loader = createDicomLoader();
  const chunks = [0, 1, 2].map((index) =>
    loader.createChunk(
      new Blob([
        syntheticSlice({
          sopUid: `1.2.3.${index}`,
          imagePositionPatient: [0, 0, index],
          rows: index === 2 ? 8 : 4,
        }) as BlobPart,
      ])
    )
  );
  await Promise.all(
    chunks.map(async (chunk) => {
      await chunk.loadMeta();
      await chunk.loadData();
    })
  );
  const sibling = deferred<void>();
  const prepared = deferred<void>();
  const rendered = deferred<void>();
  const images: DicomChunkImage[] = [];
  const createChunkImage = () => {
    const image = new DicomChunkImage({
      readDicomImage: async () => ({
        image: {
          size: [4, 4, 1],
          data: new Uint16Array(16).fill(42),
          imageType: { components: 1 },
        },
      }),
    });
    if (images.length === 1) image.setChunks = () => sibling.promise;
    images.push(image);
    image.addEventListener('status', (status) => {
      if (status === 'complete') rendered.resolve();
    });
    return image;
  };
  const store = useDICOMStore();
  const { volumes } = await store.importChunks([chunks[0]], {
    createChunkImage,
  });
  await rendered.promise;
  const [id] = Object.keys(volumes);
  const visible = useImageCacheStore().imageById[id];
  const original = visible.getVtkImageData();
  const replacements: unknown[] = [];
  images[0].addEventListener('imageChanged', (image) =>
    replacements.push(image)
  );
  const prepareChunks = images[0].prepareChunks.bind(images[0]);
  images[0].prepareChunks = async (...args) => {
    const update = await prepareChunks(...args);
    prepared.resolve();
    return update;
  };

  const outcome = store
    .importChunks(chunks.slice(1), { createChunkImage })
    .catch((error) => error);
  await prepared.promise;
  expect(visible.getVtkImageData()).toBe(original);
  expect(original.getDimensions()).toEqual([4, 4, 1]);
  expect(store.volumeInfo[id].NumberOfSlices).toBe(1);
  sibling.reject(new Error('cannot allocate sibling'));
  expect((await outcome).message).toContain('cannot allocate sibling');
  expect(replacements).toEqual([]);
  expect(original.isDeleted()).toBe(false);
  expect(Array.from(original.getPointData().getScalars().getData())).toEqual(
    Array(16).fill(42)
  );
  images.forEach((image) => image.dispose());
  loader.dispose();
});
