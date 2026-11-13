import { beforeEach, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { hangingSource } from '@/packages/dicom/core/source/__tests__/sourceFixtures';
import { useDICOMStore } from '@/src/store/datasets-dicom';
import { useDatasetStore } from '@/src/store/datasets';
import { useImageCacheStore } from '@/src/store/image-cache';
import {
  imageFactory,
  sliceFor,
} from '@/src/store/__tests__/dicomImportFixtures';

beforeEach(() => setActivePinia(createPinia()));

it('cancels a pending pixel read when its dataset is removed', async () => {
  const hanging = hangingSource();
  const store = useDICOMStore();
  const { volumes } = await store.importInstances(
    [sliceFor({ sop: '1.2.3.5', source: hanging.source })],
    { createImage: imageFactory().createImage }
  );
  const [id] = Object.keys(volumes);
  await hanging.pulled;

  useDatasetStore().remove(id);

  expect(await hanging.cancelled).toMatchObject({ name: 'AbortError' });
  expect(store.volumeInfo).toEqual({});
  expect(useImageCacheStore().imageById[id]).toBeUndefined();
});
