import { computed, unref } from 'vue';
import { until } from '@vueuse/core';
import useChunkStore from '../store/chunks';

export function untilLoaded(imageID: string) {
  const doneLoading = computed(
    () => !unref(useChunkStore().chunkImageById[imageID].isLoading)
  );
  return until(doneLoading).toBe(true);
}
