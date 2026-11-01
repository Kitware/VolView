<script setup lang="ts">
import { computed, ref, toRefs, watch, watchPostEffect } from 'vue';
import { useViewWindowingRanges } from '@/src/composables/useViewWindowingRanges';
import { useReferenceLinesStore } from '@/src/referenceLines';
import { slabWindowRanges } from '@/src/core/slab/windowRanges';
import { useEnFaceInput } from './useEnFaceInput';
import VtkSliceView from '@/src/components/vtk/VtkSliceView.vue';
import VtkSliceViewNavigation from '@/src/components/vtk/VtkSliceViewNavigation.vue';
import VtkSliceViewWindowManipulator from '@/src/components/vtk/VtkSliceViewWindowManipulator.vue';
import VtkSlabProjectionRepresentation from '@/src/components/vtk/VtkSlabProjectionRepresentation.vue';
import CrosshairsWidget from '@/src/components/tools/crosshairs/CrosshairsWidget.vue';
import { ReferenceLineSegments } from '@/src/referenceLines';
import { useToolStore } from '@/src/store/tools';
import { Tools } from '@/src/store/tools/types';
import { useResetViewsEvents } from '@/src/components/tools/ResetViews.vue';
import type { VtkViewApi } from '@/src/types/vtk-types';
import { useEnFaceSliceLines } from './useEnFaceSliceLines';
import ViewOverlayGrid from '@/src/components/ViewOverlayGrid.vue';
import ViewTypeSwitcher from '@/src/components/ViewTypeSwitcher.vue';
import DicomQuickInfoButton from '@/src/components/DicomQuickInfoButton.vue';
import ReasonedAction from '@/src/components/ReasonedAction.vue';
import EnFaceControlPanel from './EnFaceControlPanel.vue';
import EnFaceStatus from './EnFaceStatus.vue';
import { useEnFaceViewStore } from './store';

const props = defineProps<{ viewId: string }>();
const { viewId } = toRefs(props);
const { source, controls, specification, geometry, orientation } =
  useEnFaceInput(viewId);
const {
  currentImageID,
  currentImageData,
  currentImageMetadata,
  isImageLoading: sourceLoading,
} = source;
const autoRanges = computed(() =>
  geometry.value && currentImageData.value
    ? slabWindowRanges(currentImageData.value, specification.value)
    : null
);
const windowConfig = useViewWindowingRanges(viewId, currentImageID, autoRanges);
const vtkView = ref<VtkViewApi>();
function resetCamera() {
  vtkView.value?.resetCamera();
}
useResetViewsEvents().onClick(resetCamera);
const tools = useToolStore();
const referenceLines = useReferenceLinesStore();
watchPostEffect(() => {
  const canvas = vtkView.value?.renderWindowView.getCanvas();
  canvas?.setAttribute('data-testid', 'enface-canvas');
  canvas?.setAttribute('aria-label', 'En face projection');
});
const sliceLines = useEnFaceSliceLines(viewId, currentImageID, geometry);
const renderGeometry = computed(() => ({
  metadata: geometry.value?.metadata ?? null,
  fitKey: geometry.value?.fitKey ?? '',
}));
const fatalContextError = ref<string | null>(null);
function onRenderError(message: string) {
  fatalContextError.value = message;
}
const projectionReady = computed(
  () => !!geometry.value && !fatalContextError.value
);
const windowingManipulatorProps = computed(() => ({
  button:
    projectionReady.value && tools.currentTool === Tools.WindowLevel ? 1 : -1,
}));
const stateMessage = computed(
  () => controls.value.projectionReason || fatalContextError.value
);
const enFaceStore = useEnFaceViewStore();
const controlState = computed(() => ({
  ...controls.value,
  projectionReason: stateMessage.value,
}));
watch(
  [viewId, currentImageID, controlState],
  ([id, dataId, state]) => {
    if (dataId) enFaceStore.setControlState(id, dataId, state);
  },
  { immediate: true }
);
</script>

<template>
  <div
    class="en-face-viewer"
    tabindex="0"
    :aria-busy="sourceLoading"
    data-testid="enface-viewer"
  >
    <v-progress-linear
      v-if="sourceLoading"
      indeterminate
      height="2"
      color="grey"
      class="loading-indicator"
    />
    <VtkSliceView
      ref="vtkView"
      class="projection-view"
      :view-id="viewId"
      :image-id="currentImageID"
      :render-geometry="renderGeometry"
      :view-direction="orientation.viewDirection"
      :view-up="orientation.viewUp"
      zoom-on-scroll
    >
      <VtkSliceViewNavigation scroll-zoom />
      <VtkSliceViewWindowManipulator
        :view-id="viewId"
        :image-id="currentImageID"
        :manipulator-config="windowingManipulatorProps"
      />
      <VtkSlabProjectionRepresentation
        :image-data="geometry ? currentImageData : null"
        :geometry="geometry"
        :method="specification.method"
        :window="windowConfig"
        @error="onRenderError"
        v-slot="{ imageMatrix }"
      >
        <svg
          v-if="projectionReady && referenceLines.visible"
          class="slice-position-lines"
          data-testid="enface-slice-lines"
        >
          <ReferenceLineSegments
            :segments="sliceLines"
            :transform-matrix="imageMatrix"
            data-testid="reference-lines"
          />
        </svg>
      </VtkSlabProjectionRepresentation>
      <CrosshairsWidget
        v-if="
          tools.currentTool === Tools.Crosshairs && projectionReady && geometry
        "
        :view-id="viewId"
        :plane-origin="geometry.planeOrigin"
        :plane-normal="geometry.planeNormal"
      />
    </VtkSliceView>
    <EnFaceStatus :message="stateMessage" :ready="projectionReady" />
    <ViewOverlayGrid class="overlay-no-events view-annotations">
      <template #top-left>
        <div class="annotation-cell" @click.stop @dblclick.stop>
          <ReasonedAction
            class="pointer-events-all"
            :reason="
              geometry
                ? undefined
                : stateMessage || 'No enface projection is available.'
            "
            tooltip="Reset Camera"
            v-slot="{ disabled }"
          >
            <v-btn
              color="white"
              icon
              size="medium"
              variant="text"
              :disabled="disabled"
              aria-label="Reset Camera"
              data-testid="enface-reset-camera"
              @click="resetCamera"
            >
              <v-icon size="medium" class="py-1 view-control-icon"
                >mdi-camera-flip-outline</v-icon
              >
            </v-btn>
          </ReasonedAction>
          <span class="ml-3">{{ currentImageMetadata.name }}</span>
        </div>
      </template>
      <template #top-right
        ><div class="annotation-cell">
          <DicomQuickInfoButton :image-id="currentImageID" /></div
      ></template>
      <template #bottom-right>
        <div class="annotation-cell corner-controls" @click.stop @dblclick.stop>
          <v-menu
            :close-on-content-click="false"
            location="top end"
            :offset="8"
            :max-width="320"
          >
            <template #activator="{ props: menuProps }">
              <v-btn
                v-bind="menuProps"
                icon
                size="x-small"
                variant="flat"
                color="surface"
                border
                class="pointer-events-all"
                aria-label="En face rendering controls"
                data-testid="enface-controls"
              >
                <v-icon>mdi-tune</v-icon>
                <v-tooltip activator="parent" location="top"
                  >En face rendering controls</v-tooltip
                >
              </v-btn>
            </template>
            <EnFaceControlPanel :view-id="viewId" :data-id="currentImageID" />
          </v-menu>
          <ViewTypeSwitcher
            class="ml-0"
            :view-id="viewId"
            :image-id="currentImageID"
          />
        </div>
      </template>
    </ViewOverlayGrid>
  </div>
</template>

<style scoped src="@/src/components/styles/vtk-view.css"></style>
<style scoped>
.en-face-viewer {
  position: relative;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  background: black;
  overflow: hidden;
}
.projection-view {
  position: absolute;
  inset: 0;
}
.slice-position-lines {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  overflow: hidden;
}
.corner-controls {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
}
</style>
