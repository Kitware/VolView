<script lang="ts">
import { computed, defineComponent } from '@vue/composition-api';
import { useCurrentImage } from '../composables/useCurrentImage';
import VolumeProperties from './VolumeProperties.vue';
import VolumeRendering from './VolumeRendering.vue';

export default defineComponent({
  components: { VolumeRendering, VolumeProperties },
  setup() {
    const { currentImageData } = useCurrentImage();
    const hasCurrentImage = computed(() => !!currentImageData.value);
    return {
      hasCurrentImage,
    };
  },
});
</script>

<template>
  <div class="overflow-y-auto mx-2 fill-height">
    <template v-if="hasCurrentImage">
      <v-expansion-panels multiple accordion>
        <v-expansion-panel>
          <v-expansion-panel-header>
            <v-icon class="flex-grow-0 mr-4">mdi-palette</v-icon>
            Volume Coloring
          </v-expansion-panel-header>
          <v-expansion-panel-content>
            <volume-rendering />
          </v-expansion-panel-content>
        </v-expansion-panel>
        <v-expansion-panel>
          <v-expansion-panel-header>
            <v-icon class="flex-grow-0 mr-4">mdi-cube-scan</v-icon>
            Volume Rendering
          </v-expansion-panel-header>
          <v-expansion-panel-content>
            <volume-properties />
          </v-expansion-panel-content>
        </v-expansion-panel>
      </v-expansion-panels>
    </template>
    <template v-else>
      <div class="text-center pt-12 text-subtitle-1">No image selected</div>
    </template>
  </div>
</template>
