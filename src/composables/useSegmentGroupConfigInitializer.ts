import { watchImmediate } from '@vueuse/core';
import { MaybeRef, computed, unref } from 'vue';
import useLayerColoringStore from '@/src/store/view-configs/layers';
import { useSegmentGroupConfigStore } from '@/src/store/view-configs/segmentGroups';

function useLayerConfigInitializerForSegmentGroups(
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
    coloringStore.initConfig(viewIdVal, layerIdVal); // initConfig instead of resetColorPreset for layers
    coloringStore.updateBlendConfig(viewIdVal, layerIdVal, {
      opacity: 0.3,
    });
  });
}

export function useSegmentGroupConfigInitializer(
  viewId: MaybeRef<string>,
  segmentGroupId: MaybeRef<string>
) {
  useLayerConfigInitializerForSegmentGroups(viewId, segmentGroupId);

  const configStore = useSegmentGroupConfigStore();
  const config = computed(() =>
    configStore.getConfig(unref(viewId), unref(segmentGroupId))
  );

  watchImmediate(config, (config_) => {
    if (config_) return;
    const viewIdVal = unref(viewId);
    const layerIdVal = unref(segmentGroupId);
    configStore.initConfig(viewIdVal, layerIdVal);
  });
}
