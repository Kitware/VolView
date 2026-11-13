import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

import { useImageCacheStore } from '@/src/store/image-cache';
import {
  LoadedVtkImage,
  type ProgressiveImage,
  type ProgressiveImageEvents,
} from '@/src/core/progressiveImage';
import { getEnFaceUnavailableReason } from '@/src/enface/availability';
import mitt from 'mitt';

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

  it('treats a disposed image still in the cache as absent', () => {
    const store = seatImage();
    // vtk.js delete() strips the model but keeps the closures, so the getters
    // return undefined instead of throwing.
    store.imageById['img-1'].dispose();

    expect(store.getVtkImageData('img-1')).toBeNull();
  });

  it('enables En face after a failed volume finishes a successful retry', () => {
    const store = seatImage();
    const data = store.getVtkImageData('img-1')!;
    const image: ProgressiveImage = new LoadedVtkImage(data, 'Retry');
    const events = mitt<ProgressiveImageEvents>();
    image.addEventListener = events.on;
    image.removeEventListener = events.off;
    store.addProgressiveImage(image, { id: 'retry' });
    events.emit('error', new Error('decode failed'));
    expect(getEnFaceUnavailableReason('retry')).toBe(
      'The volume failed to load completely.'
    );
    events.emit('status', 'complete');
    expect(getEnFaceUnavailableReason('retry')).toBe(
      'The volume failed to load completely.'
    );
    events.emit('loading', true);
    events.emit('loading', false);
    events.emit('status', 'complete');
    expect(getEnFaceUnavailableReason('retry')).toBeNull();
  });
});
