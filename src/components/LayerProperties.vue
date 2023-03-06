<script lang="ts">
import { computed, defineComponent, watch } from '@vue/composition-api';
import { InitViewSpecs } from '../config';
import { useImageStore } from '../store/datasets-images';
import { useDICOMStore } from '../store/datasets-dicom';
import { useViewConfigStore } from '../store/view-configs';
import { BlendConfig } from '../types/views';

const VIEWS_2D = Object.entries(InitViewSpecs)
  .filter(([, { viewType }]) => viewType === '2D')
  .map(([viewID]) => viewID);

export default defineComponent({
  name: 'LayerProperties',
  props: {
    imageID: String,
  },
  setup(props) {
    const dicomStore = useDICOMStore();
    const imageStore = useImageStore();

    const imageName = computed(() => {
      return (
        props.imageID &&
        (dicomStore.volumeInfo[dicomStore.imageIDToVolumeKey[props.imageID]]
          ?.Modality ||
          imageStore.metadata[props.imageID]?.name)
      );
    });

    const viewConfigStore = useViewConfigStore();

    const layerConfigs = computed(() =>
      VIEWS_2D.map((viewID) => ({
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
