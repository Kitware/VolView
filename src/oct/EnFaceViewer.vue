<script setup lang="ts">
import { computed, reactive, ref, shallowRef, toRefs, watch } from 'vue';
import { useEnFaceWindowing } from './useEnFaceWindowing';
import { useThinRegionAppearance } from './useThinRegionAppearance';
import { thicknessSliderMaximum, thinRegionOutlinePath } from './thickness';
import { useEnFaceSliceLines } from './useEnFaceSliceLines';
import {
  projectionWindowRanges as windowRanges,
  paintThinRegionPixels,
  paintProjectionIntensities as paintIntensities,
} from './windowLevel';
import ViewOverlayGrid from '@/src/components/ViewOverlayGrid.vue';
import ViewTypeSwitcher from '@/src/components/ViewTypeSwitcher.vue';
import DicomQuickInfoButton from '@/src/components/DicomQuickInfoButton.vue';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { onVTKEvent } from '@/src/composables/onVTKEvent';
import { useSegmentationStore } from '@/src/segmentation/store';
import { useSegmentStore } from '@/src/segmentation/segments';
import { extentSize } from '@/src/segmentation/geometry';
import EnFaceControls from './EnFaceControls.vue';
import EnFaceStatus from './EnFaceStatus.vue';
import EnFaceProjectionView from './EnFaceProjectionView.vue';
import { getOCTAvailability } from './availability';
import { defaultOCTViewConfig, useOCTViewStore } from './store';
import type { ProjectionInput, ProjectionResult } from './types';

const props = defineProps<{ viewId: string }>();
const { viewId } = toRefs(props);
const {
  currentImageID,
  currentImageData,
  currentImageMetadata,
  isImageLoading: sourceLoading,
} = useCurrentImage();
const segmentationStore = useSegmentationStore();
const segmentsRegistry = useSegmentStore().segments;
const octStore = useOCTViewStore();
const emptySettings = reactive(defaultOCTViewConfig());
const settings = computed(() =>
  currentImageID.value
    ? octStore.configFor(viewId.value, currentImageID.value)
    : emptySettings
);
const availability = computed(() => getOCTAvailability(currentImageID.value));
const projectionReason = computed(() => availability.value.reason);
const dimensions = computed(
  () => currentImageData.value?.getDimensions() ?? [1, 1, 1]
);
const depthMaximum = computed(() =>
  Math.max(0, dimensions.value[settings.value.axis] - 1)
);
const depthStart = computed(() =>
  Math.min(depthMaximum.value, Math.max(0, settings.value.depthStart))
);
const depthEnd = computed(() =>
  Math.max(
    depthStart.value,
    Math.min(depthMaximum.value, settings.value.depthEnd ?? depthMaximum.value)
  )
);

const segmentOptions = computed(() => {
  if (!currentImageID.value) return [];
  return segmentationStore.boundMaskIds(currentImageID.value).map((maskId) => {
    const mask = segmentationStore.getMask(maskId);
    const appearance = segmentsRegistry.appearanceOf(mask.segmentId);
    return {
      value: maskId,
      title: appearance.displayName,
      color: appearance.cssColor,
    };
  });
});
watch(
  [settings, segmentOptions],
  ([config, options]) => {
    if (!options.some((option) => option.value === config.selectedMaskId)) {
      if (config.selectedMaskId) config.highlightThin = false;
      config.selectedMaskId = options[0]?.value ?? null;
    }
  },
  { immediate: true }
);
const selectedBinding = computed(() =>
  settings.value.selectedMaskId
    ? segmentationStore.findMaskBinding(settings.value.selectedMaskId)
    : undefined
);
const segmentationReason = computed(
  () =>
    projectionReason.value ||
    (!segmentOptions.value.length
      ? 'Load or create a segmentation mask associated with this OCT volume.'
      : null)
);
const volumeRevision = ref(0);
const maskRevision = ref(0);
function arraysNear(left: ArrayLike<number>, right: ArrayLike<number>) {
  return (
    left.length === right.length &&
    Array.from(left).every(
      (value, index) => Math.abs(value - right[index]) < 1e-5
    )
  );
}
const maskGeometryReason = computed(() => {
  void volumeRevision.value;
  void maskRevision.value;
  const binding = selectedBinding.value;
  const parent = currentImageData.value;
  if (!binding || !parent) return null;
  const extent = binding.extent;
  const validExtent = extent.every(
    (value, index) =>
      Number.isInteger(value) &&
      value >= 0 &&
      value < dimensions.value[Math.floor(index / 2)]
  );
  const gridMatches =
    arraysNear(binding.image.getDimensions(), extentSize(extent)) &&
    arraysNear(binding.image.getSpacing(), parent.getSpacing()) &&
    arraysNear(binding.image.getDirection(), parent.getDirection());
  const originMatches = arraysNear(
    binding.image.getOrigin(),
    parent.indexToWorld([extent[0], extent[2], extent[4]])
  );
  return validExtent && gridMatches && originMatches
    ? null
    : 'This segmentation mask does not match the OCT voxel grid; align it to the volume before measuring thickness.';
});
const highlightEligibilityReason = computed(
  () =>
    segmentationReason.value ||
    (!availability.value.calibratedAxes[settings.value.axis]
      ? 'Physical units or spacing for this A-line axis are unavailable; thickness in micrometers is unavailable.'
      : null)
);
const thicknessReason = computed(
  () => highlightEligibilityReason.value || maskGeometryReason.value
);

const highlightAppearance = useThinRegionAppearance(
  computed(() => settings.value.selectedMaskId)
);
const highlightReason = computed(
  () => thicknessReason.value || highlightAppearance.value?.reason || null
);

// Scalar and mask storage can change in place during streaming or segmentation editing.
const volumeScalars = computed(() =>
  currentImageData.value?.getPointData().getScalars()
);
const maskImage = computed(() => selectedBinding.value?.image);
onVTKEvent(currentImageData, 'onModified', () => {
  volumeRevision.value += 1;
});
onVTKEvent(volumeScalars, 'onModified', () => {
  volumeRevision.value += 1;
});
onVTKEvent(maskImage, 'onModified', () => {
  maskRevision.value += 1;
});

const retry = ref(0);
const projectionRequest = computed(() => {
  // Track VTK events even though the underlying arrays are intentionally raw.
  void volumeRevision.value;
  void maskRevision.value;
  void retry.value;
  if (projectionReason.value || !currentImageData.value || !volumeScalars.value)
    return null;
  const request: ProjectionInput = {
    volume: {
      scalars: volumeScalars.value.getData(),
      dimensions: [...dimensions.value],
      spacing: currentImageData.value.getSpacing().map(Math.abs),
      numberOfComponents: volumeScalars.value.getNumberOfComponents(),
      paddingRanges: availability.value.paddingRanges,
    },
    axis: settings.value.axis,
    method: settings.value.method,
    depthStart: depthStart.value,
    depthEnd: depthEnd.value,
  };
  const binding = selectedBinding.value;
  if (binding && !thicknessReason.value) {
    const scalars = binding.image.getPointData().getScalars();
    request.segmentation = {
      scalars: scalars.getData(),
      dimensions: [...binding.image.getDimensions()],
      extent: [...binding.extent],
      numberOfComponents: scalars.getNumberOfComponents(),
    };
  }
  return request;
});

const projection = shallowRef<ProjectionResult | null>(null);
const thresholdMaximum = computed(() =>
  thicknessSliderMaximum(projection.value)
);
const renderedRequest = shallowRef<ProjectionInput | null>(null);
const computing = ref(false);
const projectionError = ref<string | null>(null);
watch(
  projectionRequest,
  (request, _oldRequest, onCleanup) => {
    let active = true;
    let worker: Worker | undefined;
    onCleanup(() => {
      active = false;
      worker?.terminate();
    });
    projection.value = null;
    renderedRequest.value = null;
    projectionError.value = null;
    computing.value = !!request;
    if (!request) return;
    const fail = (message: string) => {
      if (!active) return;
      projectionError.value = message;
      computing.value = false;
      worker?.terminate();
    };
    try {
      worker = new Worker(new URL('./projection.worker.ts', import.meta.url), {
        type: 'module',
      });
      worker.onmessage = (event: MessageEvent<ProjectionResult>) => {
        if (!active) return;
        projection.value = event.data;
        renderedRequest.value = request;
        computing.value = false;
        worker?.terminate();
      };
      worker.onerror = (event) =>
        fail(event.message || 'The OCT projection worker failed.');
      worker.onmessageerror = () => fail('The OCT projection worker failed.');
      // Structured cloning preserves buffers used by the source views.
      worker.postMessage(request);
    } catch (error) {
      fail(
        error instanceof Error ? error.message : 'En face projection failed.'
      );
    }
  },
  { immediate: true }
);

const projectionStats = computed(() => {
  const result = projection.value;
  return result ? windowRanges(result.values) : null;
});
const autoRange = computed(
  () => projectionStats.value ?? { width: 1, level: 0.5, min: 0, max: 1 }
);
const windowConfig = useEnFaceWindowing(
  viewId,
  currentImageID,
  computed(() => projectionStats.value?.ranges ?? null)
);
const sliceLines = useEnFaceSliceLines(
  viewId,
  currentImageID,
  computed(() => renderedRequest.value?.axis ?? settings.value.axis),
  computed(() =>
    renderedRequest.value
      ? (renderedRequest.value.depthStart + renderedRequest.value.depthEnd) / 2
      : 0
  )
);

const highlightOutline = computed(() => {
  const result = projection.value;
  const appearance = highlightAppearance.value;
  return result &&
    settings.value.highlightThin &&
    !highlightReason.value &&
    appearance &&
    appearance.outlineWidth > 0 &&
    appearance.outlineOpacity > 0
    ? thinRegionOutlinePath(result, settings.value.thresholdMicrons)
    : '';
});
const projectionFrame = computed(() => {
  const result = projection.value;
  const request = renderedRequest.value;
  if (!result || !request) return null;
  const pixels = new Uint8ClampedArray(result.width * result.height * 4);
  paintIntensities(result.values, pixels, windowConfig.value);
  if (
    settings.value.highlightThin &&
    !highlightReason.value &&
    result.thicknessMicrons &&
    highlightAppearance.value
  )
    paintThinRegionPixels(
      pixels,
      result.thicknessMicrons,
      settings.value.thresholdMicrons,
      { ...highlightAppearance.value, values: result.values }
    );
  const axes = [0, 1, 2].filter((axis) => axis !== request.axis);
  return {
    width: result.width,
    height: result.height,
    spacing: axes.map((axis) => Math.abs(request.volume.spacing[axis])),
    pixels: new Uint8Array(pixels.buffer),
  };
});
const stateMessage = computed(
  () =>
    projectionReason.value ||
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
    <EnFaceProjectionView
      :view-id="viewId"
      :image-id="currentImageID"
      :frame="projectionFrame"
      :window-range="autoRange"
      :window-config="windowConfig"
      v-slot="{ imageTransform }"
    >
      <svg
        v-if="projection"
        class="slice-position-lines"
        data-testid="oct-slice-lines"
      >
        <g :transform="imageTransform">
          <path
            v-if="highlightOutline && highlightAppearance"
            :d="highlightOutline"
            fill="none"
            :stroke="`rgb(${highlightAppearance.color.slice(0, 3).join(',')})`"
            :stroke-opacity="highlightAppearance.outlineOpacity"
            :stroke-width="highlightAppearance.outlineWidth"
            stroke-linecap="square"
            vector-effect="non-scaling-stroke"
            data-testid="oct-thin-outline"
          />
          <line
            v-for="line in sliceLines"
            :key="line.viewId"
            v-bind="line"
            :data-view-id="line.viewId"
            data-testid="oct-slice-line"
          />
        </g>
      </svg>
    </EnFaceProjectionView>
    <EnFaceStatus
      :message="stateMessage"
      :ready="!!projection"
      :retryable="!!projectionError && !projectionReason"
      @retry="retry += 1"
    />
    <ViewOverlayGrid class="overlay-no-events view-annotations">
      <template #top-left>
        <div class="annotation-cell">{{ currentImageMetadata.name }}</div>
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
              :depth-maximum="depthMaximum"
              :threshold-maximum="thresholdMaximum"
              :projection-reason="projectionReason"
              :segmentation-reason="segmentationReason"
              :thickness-reason="highlightReason || stateMessage"
              :highlight-reason="highlightEligibilityReason"
              :segments="segmentOptions"
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
