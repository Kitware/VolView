<script setup lang="ts">
import { computed, onScopeDispose, ref, toRefs, watchPostEffect } from 'vue';
import { useDerivedImageWindowing } from '@/src/composables/useDerivedImageWindowing';
import { imageWindowRanges } from '@/src/utils/imageWindowing';
import { useScalarImagePlane } from '@/src/core/vtk/useScalarImagePlane';
import { useEnFaceProjection } from './useEnFaceProjection';
import { useEnFaceInput } from './useEnFaceInput';
import VtkEnFaceLabelmapRepresentation from './VtkEnFaceLabelmapRepresentation.vue';
import VtkSliceView from '@/src/components/vtk/VtkSliceView.vue';
import VtkSliceViewNavigation from '@/src/components/vtk/VtkSliceViewNavigation.vue';
import VtkSliceViewWindowManipulator from '@/src/components/vtk/VtkSliceViewWindowManipulator.vue';
import VtkImagePlaneRepresentation from '@/src/components/vtk/VtkImagePlaneRepresentation.vue';
import { useToolStore } from '@/src/store/tools';
import { Tools } from '@/src/store/tools/types';
import { useResetViewsEvents } from '@/src/components/tools/ResetViews.vue';
import { useWebGLWatchdog } from '@/src/composables/useWebGLWatchdog';
import type { VtkViewApi } from '@/src/types/vtk-types';
import { useThinRegionAppearance } from './useThinRegionAppearance';
import { thicknessSliderMaximum } from './thickness';
import { useEnFaceSliceLines } from './useEnFaceSliceLines';
import ViewOverlayGrid from '@/src/components/ViewOverlayGrid.vue';
import ViewTypeSwitcher from '@/src/components/ViewTypeSwitcher.vue';
import DicomQuickInfoButton from '@/src/components/DicomQuickInfoButton.vue';
import ReasonedAction from '@/src/components/ReasonedAction.vue';
import EnFaceControls from './EnFaceControls.vue';
import EnFaceStatus from './EnFaceStatus.vue';

const props = defineProps<{ viewId: string }>();
const { viewId } = toRefs(props);
const { source, settings, controls, request, retry } = useEnFaceInput(viewId);
const {
  currentImageID,
  currentImageMetadata,
  isImageLoading: sourceLoading,
} = source;
const highlightAppearance = useThinRegionAppearance(
  computed(() => settings.value.selectedMaskId)
);
const highlightReason = computed(
  () =>
    controls.value.thicknessReason || highlightAppearance.value?.reason || null
);

const {
  accepted,
  computing,
  error: projectionError,
} = useEnFaceProjection(request);
const projection = computed(() => accepted.value?.result ?? null);
const renderedGeometry = computed(() => accepted.value?.render ?? null);
const thresholdMaximum = computed(() =>
  thicknessSliderMaximum(projection.value)
);
const projectionStats = computed(() =>
  projection.value ? imageWindowRanges(projection.value.values) : null
);
const windowConfig = useDerivedImageWindowing(
  viewId,
  currentImageID,
  computed(() => projectionStats.value?.ranges ?? null)
);
const vtkView = ref<VtkViewApi>();
useWebGLWatchdog(vtkView);
function resetCamera() {
  vtkView.value?.resetCamera();
}
const resets = useResetViewsEvents().onClick(resetCamera);
onScopeDispose(resets.off);
const tools = useToolStore();
const windowingManipulatorProps = computed(() => ({
  button: tools.currentTool === Tools.WindowLevel ? 1 : -1,
}));
watchPostEffect(() => {
  const canvas = vtkView.value?.renderWindowView.getCanvas();
  canvas?.setAttribute('data-testid', 'oct-en-face-canvas');
  canvas?.setAttribute('aria-label', 'OCT en face projection');
});
const sliceLines = useEnFaceSliceLines(
  viewId,
  currentImageID,
  computed(() => renderedGeometry.value?.axis ?? settings.value.axis),
  computed(() => renderedGeometry.value?.depthMidpoint ?? 0)
);

const projectionPlane = computed(() => {
  const result = projection.value;
  const geometry = renderedGeometry.value;
  if (!result || !geometry) return null;
  return {
    width: result.width,
    height: result.height,
    spacing: geometry.spacing,
    values: result.values,
  };
});
const {
  imageData: planeImage,
  metadata: planeGeometry,
  offset: scalarOffset,
} = useScalarImagePlane(projectionPlane);
const renderGeometry = computed(() => {
  const plane = projectionPlane.value;
  return {
    metadata: planeGeometry.value,
    fitKey: plane
      ? [
          renderedGeometry.value!.axis,
          plane.width,
          plane.height,
          ...plane.spacing,
        ].join(',')
      : '',
  };
});
const labelmapAppearance = computed(() =>
  settings.value.highlightThin && !highlightReason.value
    ? highlightAppearance.value
    : null
);
const stateMessage = computed(
  () =>
    controls.value.projectionReason ||
    projectionError.value ||
    (computing.value ? 'Generating en face projection…' : null)
);
</script>

<template>
  <div
    class="en-face-viewer"
    tabindex="0"
    :aria-busy="computing"
    data-testid="oct-en-face-viewer"
  >
    <v-progress-linear
      v-if="computing || sourceLoading"
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
      view-direction="Inferior"
      view-up="Posterior"
      zoom-on-scroll
    >
      <VtkSliceViewNavigation scroll-zoom />
      <VtkSliceViewWindowManipulator
        :view-id="viewId"
        :image-id="currentImageID"
        :manipulator-config="windowingManipulatorProps"
      />
      <VtkImagePlaneRepresentation
        :image-data="planeImage"
        :window="windowConfig"
        :scalar-offset="scalarOffset"
        v-slot="{ imageTransform }"
      >
        <svg
          v-if="projection"
          class="slice-position-lines"
          data-testid="oct-slice-lines"
        >
          <g :transform="imageTransform">
            <line
              v-for="line in sliceLines"
              :key="line.viewId"
              v-bind="line"
              :data-view-id="line.viewId"
              data-testid="oct-slice-line"
            />
          </g>
        </svg>
      </VtkImagePlaneRepresentation>
      <VtkEnFaceLabelmapRepresentation
        :image-data="planeImage"
        :projection="projection"
        :threshold="settings.thresholdMicrons"
        :appearance="labelmapAppearance"
      />
    </VtkSliceView>
    <EnFaceStatus
      :message="stateMessage"
      :ready="!!projection"
      :retryable="!!projectionError && !controls.projectionReason"
      @retry="retry"
    />
    <ViewOverlayGrid class="overlay-no-events view-annotations">
      <template #top-left>
        <div class="annotation-cell" @click.stop @dblclick.stop>
          <ReasonedAction
            class="pointer-events-all"
            :reason="
              planeGeometry
                ? undefined
                : stateMessage || 'No en face projection is available.'
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
              data-testid="oct-reset-camera"
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
                data-testid="oct-en-face-controls"
              >
                <v-icon>mdi-tune</v-icon>
                <v-tooltip activator="parent" location="top"
                  >En face rendering controls</v-tooltip
                >
              </v-btn>
            </template>
            <EnFaceControls
              :settings="settings"
              @patch="Object.assign(settings, $event)"
              :depth-maximum="controls.depthMaximum"
              :threshold-maximum="thresholdMaximum"
              :projection-reason="controls.projectionReason"
              :segmentation-reason="controls.segmentationReason"
              :thickness-reason="highlightReason || stateMessage"
              :highlight-reason="controls.highlightEligibilityReason"
              :segments="controls.segmentOptions"
            />
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
.slice-position-lines line {
  stroke: yellow;
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}
.corner-controls {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
}
</style>
