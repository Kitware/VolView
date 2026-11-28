import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

import { useImageCacheStore } from '@/src/store/image-cache';
import { useMessageStore } from '@/src/store/messages';
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

  // An image whose events the test fires, seated under 'retry'.
  const seatLoading = () => {
    const store = seatImage();
    const data = store.getVtkImageData('img-1')!;
    const image: ProgressiveImage = new LoadedVtkImage(data, 'Retry');
    const events = mitt<ProgressiveImageEvents>();
    image.addEventListener = events.on;
    image.removeEventListener = events.off;
    store.addProgressiveImage(image, { id: 'retry' });
    return events;
  };

  it('tells the user once per load which image lost slices', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const events = seatLoading();
    const titles = () =>
      useMessageStore().messages.map((message) => message.title);

    events.emit('loading', true);
    ['slice 1', 'slice 2', 'slice 3'].forEach((slice) =>
      events.emit('error', new Error(slice))
    );
    events.emit('loading', false);
    expect(titles()).toEqual(['Error loading Retry']);
    expect(useImageCacheStore().imageErrors.retry).toHaveLength(3);

    events.emit('loading', true);
    events.emit('error', new Error('slice 2'));
    expect(titles()).toEqual(['Error loading Retry', 'Error loading Retry']);
  });

  it('enables En face after a failed volume finishes a successful retry', () => {
    const events = seatLoading();
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
