<script lang="ts">
import { computed, defineComponent, PropType, toRefs } from 'vue';
import { useImageCacheStore } from '@/src/store/image-cache';
import { NO_NAME } from '@/src/constants';
import { InitViewSpecs } from '../config';
import { BlendConfig } from '../types/views';
import { Layer } from '../store/datasets-layers';
import useLayerColoringStore from '../store/view-configs/layers';

const VIEWS_2D = Object.entries(InitViewSpecs)
  .filter(([, { viewType }]) => viewType === '2D')
  .map(([viewID]) => viewID);

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

    const imageName = computed(() => {
      const { selection } = props.layer;
      return imageCacheStore.getImageMetadata(selection)?.name ?? NO_NAME;
    });

    const layerColoringStore = useLayerColoringStore();

    const layerID = computed(() => layer.value.id);

    const layerConfigs = computed(() =>
      VIEWS_2D.map((viewID) => ({
        config: layerColoringStore.getConfig(viewID, layerID.value),
        viewID,
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
