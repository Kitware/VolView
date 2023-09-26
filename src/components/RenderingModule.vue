<script lang="ts">
import { computed, defineComponent, ref } from 'vue';
import { useCurrentImage } from '../composables/useCurrentImage';
import VolumeProperties from './VolumeProperties.vue';
import VolumeRendering from './VolumeRendering.vue';
import VolumePresets from './VolumePresets.vue';
import WebXRRendering from './WebXRRendering.vue';
import LayerList from './LayerList.vue';

export default defineComponent({
  components: { VolumeRendering, VolumePresets, VolumeProperties, WebXRRendering, LayerList },
  setup() {
    const { currentImageData } = useCurrentImage();
    const hasCurrentImage = computed(() => !!currentImageData.value);

    const { currentLayers } = useCurrentImage();
    const hasLayers = computed(() => !!currentLayers.value.length);

    const panels = ref<string[]>(['properties', 'layers']);

    return {
      panels,
      hasCurrentImage,
      hasLayers,
    };
  },
});
</script>

<template>
  <div class="overflow-y-auto mx-2 fill-height">
    <template v-if="hasCurrentImage">
      <volume-rendering />
      <v-expansion-panels v-model="panels" multiple variant="accordion">

        <v-expansion-panel value="preset">
          <v-expansion-panel-title>
            <v-icon class="flex-grow-0 mr-4">mdi-palette</v-icon>
            Color Presets
          </v-expansion-panel-title>
          <v-expansion-panel-text>
            <volume-presets />
          </v-expansion-panel-text>
        </v-expansion-panel>

        <v-expansion-panel value="properties">
          <v-expansion-panel-title>
            <v-icon class="flex-grow-0 mr-4">mdi-cube-scan</v-icon>
            Cinematic Rendering
          </v-expansion-panel-title>
          <v-expansion-panel-text>
            <volume-properties />
          </v-expansion-panel-text>
        </v-expansion-panel>

        <v-expansion-panel v-if="hasLayers" value="layers">
          <v-expansion-panel-title>
            <v-icon class="flex-grow-0 mr-4">mdi-layers</v-icon>
            Layers
          </v-expansion-panel-title>
          <v-expansion-panel-text>
            <layer-list />
          </v-expansion-panel-text>
        </v-expansion-panel>
        
        <v-expansion-panel value="webxr">
          <v-expansion-panel-title>
            <v-icon class="flex-grow-0 mr-4">mdi-palette</v-icon>
            WebXR Rendering
          </v-expansion-panel-title>
          <v-expansion-panel-text>
            <web-x-r-rendering />
          </v-expansion-panel-text>
        </v-expansion-panel>
        
      </v-expansion-panels>
    </template>
    <template v-else>
      <div class="text-center pt-12 text-subtitle-1">No image selected</div>
    </template>
  </div>
</template>
