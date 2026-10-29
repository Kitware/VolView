<script lang="ts">
import { computed, defineComponent, ref, unref, watch } from 'vue';
import { useViewStore } from '@/src/store/views';
import {
  getImageMetadata,
  useCurrentImage,
} from '../composables/useCurrentImage';
import { EnFaceControlPanel } from '@/src/enface';
import VolumeProperties from './VolumeProperties.vue';
import VolumeRendering from './VolumeRendering.vue';
import VolumePresets from './VolumePresets.vue';
import LayerList from './LayerList.vue';

export default defineComponent({
  components: {
    VolumeRendering,
    VolumePresets,
    VolumeProperties,
    LayerList,
    EnFaceControlPanel,
  },
  setup() {
    // Use global current image - this gets the first loaded image when no view is selected
    const { currentImageData, currentImage, currentImageID } =
      useCurrentImage('global');

    const viewStore = useViewStore();
    const enFaceViews = computed(() =>
      viewStore.visibleViews.filter((view) => view.type === 'EnFace')
    );
    const lastEnFaceId = ref<string>();
    watch(
      () => viewStore.activeView,
      (id) => {
        if (id && viewStore.getView(id)?.type === 'EnFace')
          lastEnFaceId.value = id;
      },
      { immediate: true }
    );
    const enFaceView = computed(
      () =>
        enFaceViews.value.find((view) => view.id === viewStore.activeView) ??
        enFaceViews.value.find((view) => view.id === lastEnFaceId.value) ??
        enFaceViews.value[0]
    );
    const enFaceChoices = computed(() =>
      enFaceViews.value.map((view, index) => ({
        title: `En face ${index + 1} (${getImageMetadata(view.dataID).name})`,
        value: view.id,
      }))
    );
    const selectEnFace = (id: string) => viewStore.setActiveView(id);

    // Get 3D view ID - prefer active view if it's 3D and shows current image,
    // otherwise find any 3D view showing current image
    const view3DId = computed(() => {
      const activeView = viewStore.getView(viewStore.activeView);
      if (
        activeView?.type === '3D' &&
        activeView.dataID === currentImageID.value &&
        viewStore.visibleViews.includes(activeView)
      ) {
        return activeView.id;
      }

      const any3DView = viewStore.visibleViews.find(
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

    const panels = ref<string[]>(['volume', 'layers', 'enface']);
    const volumePanels = ref<string[]>(['properties']);

    return {
      panels,
      volumePanels,
      hasCurrentImage,
      isImageLoading,
      canShow3DControls,
      view3DId,
      enFaceView,
      enFaceChoices,
      selectEnFace,
    };
  },
});
</script>

<template>
  <div class="mx-2 mt-1">
    <template v-if="hasCurrentImage || enFaceView">
      <div
        v-if="hasCurrentImage && !canShow3DControls"
        class="pt-4 text-body-2 text-center text-medium-emphasis"
      >
        Create a 3D view to access volume rendering controls
      </div>

      <v-expansion-panels v-model="panels" multiple variant="accordion">
        <v-expansion-panel
          v-if="canShow3DControls"
          value="volume"
          data-testid="volume-rendering-panel"
        >
          <v-expansion-panel-title data-testid="volume-rendering-toggle">
            <v-icon class="flex-grow-0 mr-4">mdi-cube-outline</v-icon>
            3D Rendering
          </v-expansion-panel-title>
          <v-expansion-panel-text eager class="volume-controls">
            <v-skeleton-loader v-if="isImageLoading" type="image" />
            <volume-rendering v-else :view-id="view3DId" />

            <v-expansion-panels
              v-model="volumePanels"
              multiple
              variant="accordion"
            >
              <v-expansion-panel value="preset">
                <v-expansion-panel-title>
                  <v-icon class="flex-grow-0 mr-4">mdi-palette</v-icon>
                  Color Presets
                </v-expansion-panel-title>
                <v-expansion-panel-text>
                  <volume-presets :view-id="view3DId" />
                </v-expansion-panel-text>
              </v-expansion-panel>

              <v-expansion-panel value="properties">
                <v-expansion-panel-title>
                  <v-icon class="flex-grow-0 mr-4">mdi-cube-scan</v-icon>
                  Cinematic Rendering
                </v-expansion-panel-title>
                <v-expansion-panel-text>
                  <volume-properties :view-id="view3DId" />
                </v-expansion-panel-text>
              </v-expansion-panel>
            </v-expansion-panels>
          </v-expansion-panel-text>
        </v-expansion-panel>

        <v-expansion-panel v-if="hasCurrentImage" value="layers">
          <v-expansion-panel-title>
            <v-icon class="flex-grow-0 mr-4">mdi-layers</v-icon>
            Layers
          </v-expansion-panel-title>
          <v-expansion-panel-text>
            <layer-list />
          </v-expansion-panel-text>
        </v-expansion-panel>
        <v-expansion-panel
          v-if="enFaceView"
          value="enface"
          data-testid="enface-rendering-section"
        >
          <v-expansion-panel-title data-testid="enface-rendering-toggle">
            <v-icon class="flex-grow-0 mr-4">mdi-tune</v-icon>
            En face
          </v-expansion-panel-title>
          <v-expansion-panel-text eager>
            <v-select
              v-if="enFaceChoices.length > 1"
              :model-value="enFaceView.id"
              :items="enFaceChoices"
              @update:model-value="selectEnFace"
              label="View"
              density="compact"
              hide-details
              class="mb-4"
              data-testid="enface-view-selector"
            />
            <EnFaceControlPanel
              :key="`${enFaceView.id}:${enFaceView.dataID ?? ''}`"
              :view-id="enFaceView.id"
              :data-id="enFaceView.dataID"
              embedded
              data-testid="enface-sidebar-controls"
            />
          </v-expansion-panel-text>
        </v-expansion-panel>
      </v-expansion-panels>
    </template>
    <template v-else>
      <div class="pt-12 text-subtitle-1 d-flex flex-row justify-center">
        <div class="text-center" style="max-width: 75%">
          Load an image to adjust its display settings
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.volume-controls > :deep(.v-expansion-panel-text__wrapper) {
  padding: 0;
}
</style>
