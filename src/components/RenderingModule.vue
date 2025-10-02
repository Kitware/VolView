<script lang="ts">
import { computed, defineComponent, ref, unref } from 'vue';
import { useViewStore } from '@/src/store/views';
import { useCurrentImage } from '../composables/useCurrentImage';
import VolumeProperties from './VolumeProperties.vue';
import VolumeRendering from './VolumeRendering.vue';
import VolumePresets from './VolumePresets.vue';
import LayerList from './LayerList.vue';

export default defineComponent({
  components: { VolumeRendering, VolumePresets, VolumeProperties, LayerList },
  setup() {
    // Use global current image - this gets the first loaded image when no view is selected
    const { currentImageData, currentImage, currentLayers, currentImageID } =
      useCurrentImage('global');

    const viewStore = useViewStore();

    // Get 3D view ID - prefer active view if it's 3D and shows current image,
    // otherwise find any 3D view showing current image
    const view3DId = computed(() => {
      const activeView = viewStore.getView(viewStore.activeView);
      if (
        activeView?.type === '3D' &&
        activeView.dataID === currentImageID.value
      ) {
        return activeView.id;
      }

      const any3DView = Object.values(viewStore.viewByID).find(
        (v) => v.type === '3D' && v.dataID === currentImageID.value
      );
      return any3DView?.id;
    });

    const hasCurrentImage = computed(() => !!currentImageData.value);
    const isImageLoading = computed(() => !!unref(currentImage.value?.loading));

    // Show 3D controls only if we have both an image AND a 3D view somewhere
    const canShow3DControls = computed(
      () => hasCurrentImage.value && !!view3DId.value
    );

    const hasLayers = computed(() => !!currentLayers.value.length);

    const panels = ref<string[]>(['properties', 'layers']);

    return {
      panels,
      hasCurrentImage,
      hasLayers,
      isImageLoading,
      canShow3DControls,
      view3DId,
    };
  },
});
</script>

<template>
  <div class="overflow-y-auto mx-2 mt-1 fill-height">
    <template v-if="hasCurrentImage">
      <template v-if="canShow3DControls">
        <v-skeleton-loader v-if="isImageLoading" type="image">
        </v-skeleton-loader>
        <volume-rendering v-else :view-id="view3DId" />
      </template>
      <template v-else>
        <div class="pt-4 text-body-2 text-center text-medium-emphasis">
          Create a 3D view to access volume rendering controls
        </div>
      </template>

      <v-expansion-panels v-model="panels" multiple variant="accordion">
        <v-expansion-panel v-if="canShow3DControls" value="preset">
          <v-expansion-panel-title>
            <v-icon class="flex-grow-0 mr-4">mdi-palette</v-icon>
            Color Presets
          </v-expansion-panel-title>
          <v-expansion-panel-text>
            <volume-presets :view-id="view3DId" />
          </v-expansion-panel-text>
        </v-expansion-panel>

        <v-expansion-panel v-if="canShow3DControls" value="properties">
          <v-expansion-panel-title>
            <v-icon class="flex-grow-0 mr-4">mdi-cube-scan</v-icon>
            Cinematic Rendering
          </v-expansion-panel-title>
          <v-expansion-panel-text>
            <volume-properties :view-id="view3DId" />
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
      </v-expansion-panels>
    </template>
    <template v-else>
      <div class="pt-12 text-subtitle-1 d-flex flex-row justify-center">
        <div class="text-center" style="max-width: 75%">
          Load an image and add a 3D view to see rendering controls
        </div>
      </div>
    </template>
  </div>
</template>
