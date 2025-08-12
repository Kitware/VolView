import { useImage } from '@/src/composables/useCurrentImage';
import useVolumeColoringStore from '@/src/store/view-configs/volume-coloring';
import { Maybe } from '@/src/types';
import { watchImmediate } from '@vueuse/core';
import { MaybeRef, computed, unref } from 'vue';

export function useVolumeColoringInitializer(
  viewId: MaybeRef<Maybe<string>>,
  imageId: MaybeRef<Maybe<string>>
) {
  const store = useVolumeColoringStore();
  const coloringConfig = computed(() =>
    store.getConfig(unref(viewId), unref(imageId))
  );

  const { imageData } = useImage(imageId);

  const viewIdRef = computed(() => unref(viewId));
  const imageIdRef = computed(() => unref(imageId));
  watchImmediate([coloringConfig, viewIdRef, imageIdRef], () => {
    if (coloringConfig.value) return;

    const viewIdVal = unref(viewId);
    const imageIdVal = unref(imageId);
    if (!viewIdVal || !imageIdVal || !imageData.value) return;

    store.resetToDefaultColoring(viewIdVal, imageIdVal, imageData.value);
  });
}
