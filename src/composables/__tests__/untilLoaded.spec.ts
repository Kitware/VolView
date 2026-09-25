import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

import { untilLoaded } from '@/src/composables/untilLoaded';
import { LoadedVtkImage } from '@/src/core/progressiveImage';
import { useImageCacheStore } from '@/src/store/image-cache';

beforeEach(() => setActivePinia(createPinia()));

describe('untilLoaded', () => {
  it('keeps waiting while an incomplete image has not started loading', async () => {
    const image = new LoadedVtkImage(vtkImageData.newInstance(), 'pending');
    image.loaded.value = false;
    image.status.value = 'incomplete';
    useImageCacheStore().addProgressiveImage(image, { id: 'pending' });
    let settled = false;
    const waiting = untilLoaded('pending').then(() => {
      settled = true;
    });

    await nextTick();
    expect(settled).toBe(false);

    image.status.value = 'complete';
    await waiting;
    expect(settled).toBe(true);
  });
});
