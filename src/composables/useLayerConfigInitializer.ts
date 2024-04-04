import { LayerID } from '@/src/store/datasets-layers';
import useLayerColoringStore from '@/src/store/view-configs/layers';
import { watchImmediate } from '@vueuse/core';
import { MaybeRef, computed, unref } from 'vue';

export function useLayerConfigInitializer(
  viewId: MaybeRef<string>,
  layerId: MaybeRef<LayerID>
) {
  const coloringStore = useLayerColoringStore();
  const colorConfig = computed(() =>
    coloringStore.getConfig(unref(viewId), unref(layerId))
  );

  watchImmediate(colorConfig, (config) => {
    if (config) return;

    const viewIdVal = unref(viewId);
    const layerIdVal = unref(layerId);
    coloringStore.resetColorPreset(viewIdVal, layerIdVal);
  });
}
