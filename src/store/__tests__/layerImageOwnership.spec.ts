import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { nextTick } from 'vue';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';

// The real `ensureSameSpace` runs here. Matching grids take its fast path, so
// no wasm resampling is involved.
import { useLayersStore } from '@/src/store/datasets-layers';
import { useImageCacheStore } from '@/src/store/image-cache';

const SIZE = 3;

const seatImage = (id: string) => {
  const image = vtkImageData.newInstance();
  image.setDimensions(SIZE, SIZE, SIZE);
  image.getPointData().setScalars(
    vtkDataArray.newInstance({
      name: 'scalars',
      numberOfComponents: 1,
      values: new Uint8Array(SIZE ** 3),
    })
  );
  return useImageCacheStore().addVTKImageData(image, id, { id });
};

const sourceScalars = () =>
  useImageCacheStore()
    .getVtkImageData('source')
    ?.getPointData()
    .getScalars()
    ?.getData();

beforeEach(() => {
  setActivePinia(createPinia());
  seatImage('parent');
  seatImage('source');
});

describe('layer image ownership', () => {
  it('caches a distinct image from the source it was built from', async () => {
    const imageCache = useImageCacheStore();

    await useLayersStore().addLayer('parent', 'source');

    expect(imageCache.getVtkImageData('parent::source')).not.toBe(
      imageCache.getVtkImageData('source')
    );
  });

  it('leaves the source image readable after its parent is removed', async () => {
    const store = useLayersStore();
    await store.addLayer('parent', 'source');

    store.remove('parent');
    await nextTick();

    expect(sourceScalars()).toHaveLength(SIZE ** 3);
  });

  it('leaves the source image readable after the layer is deleted', async () => {
    const store = useLayersStore();
    await store.addLayer('parent', 'source');

    store.deleteLayer('parent', 'source');
    await nextTick();

    expect(sourceScalars()).toHaveLength(SIZE ** 3);
  });
});
