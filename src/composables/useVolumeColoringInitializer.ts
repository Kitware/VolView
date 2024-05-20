import { useImage } from '@/src/composables/useCurrentImage';
import useVolumeColoringStore from '@/src/store/view-configs/volume-coloring';
import { Maybe } from '@/src/types';
import { watchImmediate } from '@vueuse/core';
import { MaybeRef, computed, unref } from 'vue';

export function useVolumeColoringInitializer(
  viewId: MaybeRef<string>,
  imageId: MaybeRef<Maybe<string>>
) {
  const store = useVolumeColoringStore();
  const coloringConfig = computed(() =>
    store.getConfig(unref(viewId), unref(imageId))
  );

  const { imageData, isLoading } = useImage(imageId);

  watchImmediate([coloringConfig, viewId, imageId, isLoading], () => {
    if (coloringConfig.value || isLoading.value) return;

    const viewIdVal = unref(viewId);
    const imageIdVal = unref(imageId);
    if (!imageIdVal || !imageData.value) return;

    store.resetToDefaultColoring(viewIdVal, imageIdVal, imageData.value);
  });
}
