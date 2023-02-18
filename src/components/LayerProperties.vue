<script lang="ts">
import { computed, defineComponent, watch } from '@vue/composition-api';
import { InitViewIDs } from '../config';
import { useViewConfigStore } from '../store/view-configs';
import { BlendConfig } from '../types/views';

export default defineComponent({
  name: 'LayerProperties',
  props: {
    imageID: String,
  },
  setup(props) {
    const viewConfigStore = useViewConfigStore();

    const layerConfigs = computed(() =>
      Object.values(InitViewIDs)
        .filter((viewID) => viewID !== InitViewIDs.Three)
        .map((viewID) => ({
          config: viewConfigStore.layers.getComputedConfig(
            viewID,
            props.imageID!
          ),
          viewID,
        }))
    );

    watch(layerConfigs, () => {
      layerConfigs.value.forEach(({ config, viewID }) => {
        if (props.imageID && !config.value) {
          // init to defaults
          viewConfigStore.layers.updateBlendConfig(viewID, props.imageID, {});
        }
      });
    });

    const blendConfig = computed(
      () => layerConfigs.value?.[0].config.value?.blendConfig
    );

    const setBlendConfig = (key: keyof BlendConfig, value: any) => {
      if (!props.imageID) return;
      layerConfigs.value.forEach(({ viewID }) =>
        viewConfigStore.layers.updateBlendConfig(viewID, props.imageID!, {
          [key]: value,
        })
      );
    };

    return {
      blendConfig,
      setBlendConfig,
    };
  },
});
</script>

<template>
  <div class="mx-2">
    <div v-if="!!blendConfig">
      <v-slider
        label="Opacity"
        min="0"
        max="1"
        step="0.01"
        dense
        hide-details
        thumb-label
        :value="blendConfig.opacity"
        @input="setBlendConfig('opacity', $event)"
      />
    </div>
  </div>
</template>
