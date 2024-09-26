import { computed, MaybeRef, unref } from 'vue';
import { InitViewSpecs } from '@/src/config';
import useLayerColoringStore from '@/src/store/view-configs/layers';
import { LayersConfig } from '@/src/store/view-configs/types';
import { useSegmentGroupConfigInitializer } from '@/src/composables/useSegmentGroupConfigInitializer';

// Returns first existing view's config as the "value" and updates all views' configs with updateConfig()
export const useGlobalLayerColorConfig = (layerId: MaybeRef<string>) => {
  const layerColoringStore = useLayerColoringStore();

  const VIEWS_2D = Object.entries(InitViewSpecs)
    .filter(([, { viewType }]) => viewType === '2D')
    .map(([viewID]) => viewID);

  useSegmentGroupConfigInitializer(VIEWS_2D[0], unref(layerId));

  const layerConfigs = computed(() =>
    VIEWS_2D.map((viewID) => ({
      config: layerColoringStore.getConfig(viewID, unref(layerId)),
      viewID,
    }))
  );

  const sampledConfig = computed(() =>
    layerConfigs.value.find(({ config }) => config)
  );

  const updateConfig = (patch: Partial<LayersConfig>) => {
    layerConfigs.value.forEach(({ viewID }) =>
      layerColoringStore.updateConfig(viewID, unref(layerId), patch)
    );
  };

  return { sampledConfig, updateConfig };
};
