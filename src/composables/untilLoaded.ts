import { computed, MaybeRef, unref } from 'vue';
import { until } from '@vueuse/core';
import { useImageCacheStore } from '@/src/store/image-cache';

export function untilLoaded(imageID: MaybeRef<string>) {
  const imageCacheStore = useImageCacheStore();
  const settled = computed(() => {
    const id = unref(imageID);
    const image = imageCacheStore.imageById[id];
    if (!image || image.status.value === 'complete') return true;
    return !image.loading.value && !!imageCacheStore.imageErrors[id]?.length;
  });
  return until(settled)
    .toBe(true)
    .then(() => {
      const image = imageCacheStore.imageById[unref(imageID)];
      if (image?.status.value !== 'complete') {
        throw new Error('Image did not load');
      }
    });
}
