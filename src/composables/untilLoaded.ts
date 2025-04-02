import { computed, MaybeRef, unref } from 'vue';
import { until } from '@vueuse/core';
import { useImageCacheStore } from '@/src/store/image-cache';

export function untilLoaded(imageID: MaybeRef<string>) {
  const imageCacheStore = useImageCacheStore();
  const doneLoading = computed(() => {
    const image = imageCacheStore.imageById[unref(imageID)];
    if (!image) return false;
    return !image.loading.value && image.status.value === 'complete';
  });
  return until(doneLoading).toBe(true);
}
