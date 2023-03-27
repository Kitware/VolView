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
import { Layer } from '../store/datasets-layers';
import { useDICOMStore } from '../store/datasets-dicom';

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
    const imageStore = useImageStore();

    const imageName = computed(() => {
      const { selection } = props.layer;
      if (selection.type === 'dicom')
        return useDICOMStore().volumeInfo[selection.volumeKey].Modality;
      if (selection.type === 'image')
        return imageStore.metadata[selection.dataID].name;

      const _exhaustiveCheck: never = selection;
      throw new Error(`invalid selection type ${_exhaustiveCheck}`);
    });

    const viewConfigStore = useViewConfigStore();

    const layerID = props.layer.id;

    const layerConfigs = computed(() =>
      VIEWS_2D.map((viewID) => ({
        config: viewConfigStore.layers.getComputedConfig(viewID, layerID),
        viewID,
      }))
    );

    watch(layerConfigs, () => {
      layerConfigs.value.forEach(({ config, viewID }) => {
        if (!config.value) {
          // init to defaults
          viewConfigStore.layers.updateBlendConfig(viewID, layerID, {});
        }
      });
    });

    const blendConfig = computed(
      () => layerConfigs.value?.[0].config.value?.blendConfig
    );

    const setBlendConfig = (key: keyof BlendConfig, value: any) => {
      layerConfigs.value.forEach(({ viewID }) =>
        viewConfigStore.layers.updateBlendConfig(viewID, layerID, {
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
