import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

import { useImageCacheStore } from '@/src/store/image-cache';

const seatImage = () => {
  const data = vtkImageData.newInstance();
  data.setDimensions(2, 2, 2);
  data.getPointData().setScalars(
    vtkDataArray.newInstance({
      name: 'scalars',
      numberOfComponents: 1,
      values: new Uint8Array(8),
    })
  );
  const store = useImageCacheStore();
  store.addVTKImageData(data, 'CT', { id: 'img-1' });
  return store;
};

describe('image cache lifecycle', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('treats an image whose VTK data is unavailable as absent', () => {
    const store = seatImage();
    vi.spyOn(store.imageById['img-1'], 'getVtkImageData').mockReturnValue(
      undefined as never
    );

    expect(store.getVtkImageData('img-1')).toBeNull();
  });
});
