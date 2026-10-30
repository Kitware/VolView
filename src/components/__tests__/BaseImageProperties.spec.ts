import { afterEach, beforeEach, expect, it } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import BaseImageProperties from '@/src/components/BaseImageProperties.vue';
import ImageDisplayControls from '@/src/components/ImageDisplayControls.vue';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useImageStatsStore } from '@/src/store/image-stats';
import { useViewStore } from '@/src/store/views';
import { useWindowingStore } from '@/src/store/view-configs/windowing';
import { cleanupCachedImages } from '@/tests/unit/imageCacheCleanup';

enableAutoUnmount(afterEach);
beforeEach(() => setActivePinia(createPinia()));
afterEach(() => cleanupCachedImages([]));

it('uses a source slice for Layers controls when the active En face cannot project', async () => {
  useImageStatsStore().stats.image = {
    scalarMin: 0,
    scalarMax: 3,
    autoRangeValues: {},
  };
  const image = vtkImageData.newInstance();
  image.setDimensions(2, 2, 1);
  image
    .getPointData()
    .setScalars(
      vtkDataArray.newInstance({ values: new Uint8Array([0, 1, 2, 3]) })
    );
  useImageCacheStore().addVTKImageData(image, '2D image', { id: 'image' });
  const views = useViewStore();
  views.setDataForAllViews('image');
  views.replaceView(views.layoutViews[0].id, {
    type: 'EnFace',
    name: 'En face',
    dataID: 'image',
    options: {},
  });
  const enFaceID = views.layoutViews[0].id;
  views.setActiveView(enFaceID);
  const sourceID = views.visibleViews.find(({ type }) => type === '2D')!.id;
  const windowing = useWindowingStore();
  const wrapper = mount(BaseImageProperties, {
    props: { imageId: 'image' },
    global: { stubs: { ImageDisplayControls: true } },
  });
  const controls = () => wrapper.getComponent(ImageDisplayControls);
  expect(controls().props('unavailableReason')).toBe('');
  expect(controls().props('visibilityUnavailableReason')).toBe('');
  controls().vm.$emit('toggle-visibility');
  expect(windowing.getConfig(sourceID, 'image').visibility).toBe(false);
  expect(windowing.getConfig(enFaceID, 'image').visibility).toBe(true);

  views.setLayoutFromGrid([1, 1]);
  await nextTick();
  expect(controls().props('unavailableReason')).toMatch(/three-dimensional/);
  expect(controls().props('visibilityUnavailableReason')).toMatch(
    /three-dimensional/
  );
});
