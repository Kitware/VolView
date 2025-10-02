import { computed, MaybeRef, unref } from 'vue';
import useLayerColoringStore from '@/src/store/view-configs/layers';
import { LayersConfig } from '@/src/store/view-configs/types';
import { useViewStore } from '@/src/store/views';

// Returns first existing view's config as the "value" and updates all views' configs with updateConfig()
export const useGlobalLayerColorConfig = (layerId: MaybeRef<string>) => {
  const layerColoringStore = useLayerColoringStore();
  const viewStore = useViewStore();

  const views2D = computed(() =>
    viewStore.getAllViews().filter((view) => view.type === '2D')
  );

  const layerConfigs = computed(() =>
    views2D.value.map((view) => ({
      config: layerColoringStore.getConfig(view.id, unref(layerId)),
      viewID: view.id,
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
