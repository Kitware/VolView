import useLayerColoringStore from '@/src/store/view-configs/layers';
import { watchImmediate } from '@vueuse/core';
import { MaybeRef, computed, unref } from 'vue';

export function useSegmentGroupConfigInitializer(
  viewId: MaybeRef<string>,
  layerId: MaybeRef<string>
) {
  const coloringStore = useLayerColoringStore();
  const colorConfig = computed(() =>
    coloringStore.getConfig(unref(viewId), unref(layerId))
  );

  watchImmediate(colorConfig, (config) => {
    if (config) return;

    const viewIdVal = unref(viewId);
    const layerIdVal = unref(layerId);
    coloringStore.initConfig(viewIdVal, layerIdVal);
  });
}
