<script setup lang="ts">
import { computed, ref, toRefs, watch, watchPostEffect } from 'vue';
import { useViewWindowingRanges } from '@/src/composables/useViewWindowingRanges';
import { useReferenceLinesStore } from '@/src/referenceLines';
import { slabWindowRanges } from '@/src/core/slab/windowRanges';
import { useEnFaceInput } from './useEnFaceInput';
import { useEnFaceOccupiedDepth } from './useEnFaceOccupiedDepth';
import VtkEnFaceLabelmapRepresentation from './VtkEnFaceLabelmapRepresentation.vue';
import VtkSliceView from '@/src/components/vtk/VtkSliceView.vue';
import VtkSliceViewNavigation from '@/src/components/vtk/VtkSliceViewNavigation.vue';
import VtkSliceViewWindowManipulator from '@/src/components/vtk/VtkSliceViewWindowManipulator.vue';
import VtkSlabProjectionRepresentation from '@/src/components/vtk/VtkSlabProjectionRepresentation.vue';
import CrosshairsWidget from '@/src/components/tools/crosshairs/CrosshairsWidget.vue';
import PaintTool from '@/src/components/tools/paint/PaintTool.vue';
import PolygonTool from '@/src/components/tools/polygon/PolygonTool.vue';
import RulerTool from '@/src/components/tools/ruler/RulerTool.vue';
import RectangleTool from '@/src/components/tools/rectangle/RectangleTool.vue';
import SelectTool from '@/src/components/tools/SelectTool.vue';
import BoundingRectangle from '@/src/components/tools/BoundingRectangle.vue';
import { useSliceInfo } from '@/src/composables/useSliceInfo';
import {
  doesToolFrameMatchViewAxis,
  isToolVisible,
} from '@/src/composables/annotationTool';
import { useToolSelectionStore } from '@/src/store/tools/toolSelection';
import { useViewStore } from '@/src/store/views';
import { useSegmentStore } from '@/src/segmentation/segments';
import { ReferenceLineSegments } from '@/src/referenceLines';
import { useAnnotationToolStore, useToolStore } from '@/src/store/tools';
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
import EnFaceMeasurementStatus from './EnFaceMeasurementStatus.vue';
import EnFaceSegmentationProjection from './EnFaceSegmentationProjection.vue';
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
const annotationSlice = useSliceInfo(viewId, currentImageID);
const annotationKey = computed(() =>
  [
    currentImageID.value,
    specification.value.axis,
    annotationSlice.value?.slice,
  ].join(':')
);
const selectionStore = useToolSelectionStore();
const selectionPoints = computed(() => {
  const slice = annotationSlice.value;
  if (!slice) return [];
  return selectionStore.selection
    .map(({ id, type }) => {
      const store = useAnnotationToolStore(type);
      return { store, tool: store.toolByID[id] };
    })
    .filter(
      ({ tool }) =>
        !!tool &&
        tool.imageID === currentImageID.value &&
        tool.slice === slice.slice &&
        isToolVisible(tool) &&
        doesToolFrameMatchViewAxis(slice.axisName, tool, currentImageMetadata)
    )
    .flatMap(({ store, tool }) => store.getPoints(tool.id));
});
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
const {
  overlay: thinRegions,
  controls: thicknessControls,
  measuring,
  message: measurementMessage,
} = useEnFaceOccupiedDepth(viewId, {
  source,
  slab: specification,
  geometry,
  blockedReason: stateMessage,
});
const enFaceStore = useEnFaceViewStore();
const views = useViewStore();
const { selectedSegmentId } = useSegmentStore().segments;
watch(
  [
    () => tools.currentTool,
    selectedSegmentId,
    currentImageID,
    () => views.activeView,
  ],
  ([tool, segmentId, imageId, activeView]) => {
    if (
      tool !== Tools.Paint ||
      !segmentId ||
      !imageId ||
      activeView !== viewId.value
    )
      return;
    const config = enFaceStore.configFor(viewId.value, imageId);
    config.showFootprints = true;
    if (!config.footprintSegmentIds.includes(segmentId))
      config.footprintSegmentIds = [...config.footprintSegmentIds, segmentId];
  },
  { immediate: true }
);
const controlState = computed(() => ({
  ...controls.value,
  projectionReason: stateMessage.value,
  thickness: thicknessControls.value,
  footprints: {
    segments: thicknessControls.value.segments,
    segmentationReason: thicknessControls.value.segmentationReason,
  },
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
    :aria-busy="sourceLoading || measuring"
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
      <VtkEnFaceLabelmapRepresentation v-bind="thinRegions" />
      <EnFaceSegmentationProjection
        :view-id="viewId"
        :source="source"
        :slab="specification"
        :geometry="geometry"
        :blocked-reason="stateMessage"
      />
      <div
        v-if="projectionReady"
        :key="annotationKey"
        class="overlay-no-events"
      >
        <PaintTool
          :view-id="viewId"
          :image-id="currentImageID"
          :view-direction="orientation.viewDirection"
        />
        <PolygonTool
          :view-id="viewId"
          :image-id="currentImageID"
          :view-direction="orientation.viewDirection"
        />
        <RulerTool
          :view-id="viewId"
          :image-id="currentImageID"
          :view-direction="orientation.viewDirection"
        />
        <RectangleTool
          :view-id="viewId"
          :image-id="currentImageID"
          :view-direction="orientation.viewDirection"
        />
        <SelectTool />
        <svg class="overlay-no-events">
          <BoundingRectangle :points="selectionPoints" />
        </svg>
      </div>
    </VtkSliceView>
    <EnFaceStatus :message="stateMessage" :ready="projectionReady" />
    <EnFaceMeasurementStatus :message="measurementMessage" />
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
      <template #bottom-left>
        <div v-if="projectionReady && annotationSlice" class="annotation-cell">
          <ReasonedAction
            class="pointer-events-all"
            tooltip="Annotations use the source slice nearest the slab midpoint. Painting and polygon rasterization edit only that slice."
          >
            <span data-testid="enface-annotation-slice">
              Annotations: {{ annotationSlice.axisName }} slice
              {{ annotationSlice.slice + 1 }}
            </span>
          </ReasonedAction>
        </div>
      </template>
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
