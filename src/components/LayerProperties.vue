<script lang="ts">
import { computed, defineComponent, PropType, toRefs } from 'vue';
import { useImageCacheStore } from '@/src/store/image-cache';
import { NO_NAME } from '@/src/constants';
import { BlendConfig } from '@/src/types/views';
import { Layer } from '@/src/store/datasets-layers';
import useLayerColoringStore from '@/src/store/view-configs/layers';
import { useViewStore } from '@/src/store/views';

export default defineComponent({
  name: 'LayerProperties',
  props: {
    layer: {
      required: true,
      type: Object as PropType<Layer>,
    },
  },
  setup(props) {
    const { layer } = toRefs(props);
    const imageCacheStore = useImageCacheStore();
    const viewStore = useViewStore();

    const imageName = computed(() => {
      const { selection } = props.layer;
      return imageCacheStore.getImageMetadata(selection)?.name ?? NO_NAME;
    });

    const layerColoringStore = useLayerColoringStore();

    const layerID = computed(() => layer.value.id);

    const layerConfigs = computed(() =>
      viewStore
        .getAllViews()
        .filter((view) => view.type === '2D')
        .map((view) => ({
          config: layerColoringStore.getConfig(view.id, layerID.value),
          viewID: view.id,
        }))
    );

    const blendConfig = computed(
      () =>
        // may be undefined if a 2D view has not been mounted
        layerConfigs.value.find(({ config }) => config)?.config?.blendConfig
    );

    const setBlendConfig = (key: keyof BlendConfig, value: any) => {
      if (layerConfigs.value.length === 0) return;
      layerConfigs.value.forEach(({ viewID }) =>
        layerColoringStore.updateBlendConfig(viewID, layerID.value, {
          [key]: value,
        })
      );
    };

    return {
      imageName,
      blendConfig,
      setBlendConfig,
    };
  },
});
</script>

<template>
  <div class="mx-2" v-if="blendConfig">
    <v-tooltip :text="imageName" location="top">
      <template v-slot:activator="{ props }">
        <h4 class="text-ellipsis" v-bind="props">{{ imageName }}</h4>
      </template>
    </v-tooltip>
    <!-- padding top so thumb value tip does not overlap image name too much -->
    <v-slider
      class="pt-4"
      label="Opacity"
      min="0"
      max="1"
      step="0.01"
      density="compact"
      hide-details
      thumb-label
      :model-value="blendConfig.opacity"
      @update:model-value="setBlendConfig('opacity', $event)"
      data-testid="layer-opacity-slider"
    />
  </div>
</template>
