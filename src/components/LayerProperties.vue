<script lang="ts">
import {
  computed,
  defineComponent,
  PropType,
  watch,
} from '@vue/composition-api';
import { InitViewSpecs } from '../config';
import { useImageStore } from '../store/datasets-images';
import { useViewConfigStore } from '../store/view-configs';
import { BlendConfig } from '../types/views';
import {
  useLayerModality,
  useLayerStore,
  LayerID,
} from '../store/datasets-layers';

const VIEWS_2D = Object.entries(InitViewSpecs)
  .filter(([, { viewType }]) => viewType === '2D')
  .map(([viewID]) => viewID);

export default defineComponent({
  name: 'LayerProperties',
  props: {
    layerID: {
      required: true,
      type: String as unknown as PropType<LayerID>,
    },
  },
  setup(props) {
    const imageStore = useImageStore();
    const layerStore = useLayerStore();

    const imageName = computed(() => {
      const imageID =
        props.layerID && layerStore.layerIDToImageID[props.layerID];
      const modality = useLayerModality(props.layerID);
      return modality.value || imageStore.metadata[imageID!]?.name;
    });

    const viewConfigStore = useViewConfigStore();

    const layerConfigs = computed(() =>
      VIEWS_2D.map((viewID) => ({
        config: viewConfigStore.layers.getComputedConfig(
          viewID,
          props.layerID!
        ),
        viewID,
      }))
    );

    watch(layerConfigs, () => {
      layerConfigs.value.forEach(({ config, viewID }) => {
        if (props.layerID && !config.value) {
          // init to defaults
          viewConfigStore.layers.updateBlendConfig(viewID, props.layerID, {});
        }
      });
    });

    const blendConfig = computed(
      () => layerConfigs.value?.[0].config.value?.blendConfig
    );

    const setBlendConfig = (key: keyof BlendConfig, value: any) => {
      if (!props.layerID) return;
      layerConfigs.value.forEach(({ viewID }) =>
        viewConfigStore.layers.updateBlendConfig(viewID, props.layerID, {
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
  <div class="mx-2" v-if="!!blendConfig">
    <v-slider
      :label="imageName + ' Opacity'"
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
</template>
