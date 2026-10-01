<script setup lang="ts">
import * as Comlink from 'comlink';
import {
  computed,
  reactive,
  ref,
  shallowRef,
  toRefs,
  useTemplateRef,
  watch,
} from 'vue';
import { useResizeObserver } from '@vueuse/core';
import { useEnFaceWindowing } from './useEnFaceWindowing';
import { useThinRegionAppearance } from './useThinRegionAppearance';
import { useEnFaceSliceLines } from './useEnFaceSliceLines';
import {
  projectionWindowRanges,
  paintThinRegionPixels,
  paintProjectionIntensities,
} from './windowLevel';
import { useEnFaceWindowLevelDrag } from './useEnFaceWindowLevelDrag';
import ViewOverlayGrid from '@/src/components/ViewOverlayGrid.vue';
import ViewTypeSwitcher from '@/src/components/ViewTypeSwitcher.vue';
import DicomQuickInfoButton from '@/src/components/DicomQuickInfoButton.vue';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { onVTKEvent } from '@/src/composables/onVTKEvent';
import { useSegmentationStore } from '@/src/segmentation/store';
import { useSegmentStore } from '@/src/segmentation/segments';
import { useImageCacheStore } from '@/src/store/image-cache';
import EnFaceControls from './EnFaceControls.vue';
import { getOCTAvailability } from './availability';
import { defaultOCTViewConfig, useOCTViewStore } from './store';
import type { ProjectionInput, ProjectionResult } from './types';
import type { ProjectionWorker } from './projection.worker';

const props = defineProps<{ viewId: string }>();
const { viewId } = toRefs(props);
const { currentImageID, currentImageData, currentImageMetadata } =
  useCurrentImage();
const imageCache = useImageCacheStore();
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
  const maskDimensions = [
    extent[1] - extent[0] + 1,
    extent[3] - extent[2] + 1,
    extent[5] - extent[4] + 1,
  ];
  const gridMatches =
    arraysNear(binding.image.getDimensions(), maskDimensions) &&
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
const thicknessReason = computed(
  () =>
    segmentationReason.value ||
    maskGeometryReason.value ||
    (!availability.value.calibratedAxes[settings.value.axis]
      ? 'Physical spacing for this A-line axis is missing from the DICOM metadata; thickness in micrometers is unavailable.'
      : null)
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
      spacing: [...currentImageData.value.getSpacing()],
      numberOfComponents: volumeScalars.value.getNumberOfComponents(),
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
      thresholdMicrons: 0,
    };
  }
  return request;
});

const projection = shallowRef<ProjectionResult | null>(null);
const renderedRequest = shallowRef<ProjectionInput | null>(null);
const computing = ref(false);
const projectionError = ref<string | null>(null);
watch(
  projectionRequest,
  (request, _oldRequest, onCleanup) => {
    let active = true;
    let worker: Worker | undefined;
    let rejectFailure: ((error: Error) => void) | undefined;
    onCleanup(() => {
      active = false;
      rejectFailure?.(new Error('The OCT projection was superseded.'));
      worker?.terminate();
    });
    projection.value = null;
    renderedRequest.value = null;
    projectionError.value = null;
    computing.value = !!request;
    if (!request) return;
    const run = async () => {
      try {
        worker = new Worker(
          new URL('./projection.worker.ts', import.meta.url),
          { type: 'module' }
        );
        const failure = new Promise<never>((_resolve, reject) => {
          rejectFailure = reject;
        });
        const handleFailure = (event: Event) =>
          rejectFailure?.(
            new Error(
              (event as ErrorEvent).message ||
                'The OCT projection worker failed.'
            )
          );
        worker.addEventListener('error', handleFailure);
        worker.addEventListener('messageerror', handleFailure);
        const remote = Comlink.wrap<ProjectionWorker>(worker);
        // Structured cloning preserves the image and mask buffers used by the other views.
        const result = await Promise.race([
          remote.projectEnFace(request),
          failure,
        ]);
        if (active) {
          projection.value = result;
          renderedRequest.value = request;
        }
      } catch (error) {
        if (active)
          projectionError.value =
            error instanceof Error
              ? error.message
              : 'En face projection failed.';
      } finally {
        worker?.terminate();
        if (active) computing.value = false;
      }
    };
    void run();
  },
  { immediate: true }
);

const projectionStats = computed(() =>
  projection.value ? projectionWindowRanges(projection.value.values) : null
);
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

const { startWindowing, moveWindowing, stopWindowing } =
  useEnFaceWindowLevelDrag({
    viewId,
    imageId: currentImageID,
    ready: computed(() => !!projection.value),
    range: autoRange,
    config: windowConfig,
  });
const canvas = useTemplateRef<HTMLCanvasElement>('canvas');
const canvasContainer = useTemplateRef<HTMLElement>('canvas-container');
const displaySize = ref({ width: 0, height: 0 });
useResizeObserver(canvasContainer, ([entry]) => {
  displaySize.value = {
    width: entry.contentRect.width,
    height: entry.contentRect.height,
  };
});
const canvasStyle = computed(() => {
  const result = projection.value;
  const request = renderedRequest.value;
  if (!result || !request) return {};
  const axes = [0, 1, 2].filter((axis) => axis !== request.axis);
  const aspect =
    (result.width * request.volume.spacing[axes[0]]) /
    (result.height * request.volume.spacing[axes[1]]);
  const width = Math.min(
    displaySize.value.width,
    displaySize.value.height * aspect
  );
  return { width: `${width}px`, height: `${width / aspect}px` };
});
const highlightedPixels = ref(0);
function paintThinRegions(result: ProjectionResult, pixels: ImageData) {
  const thickness = result.thicknessMicrons;
  const appearance = highlightAppearance.value;
  if (
    !settings.value.highlightThin ||
    highlightReason.value ||
    !thickness ||
    !appearance
  )
    return 0;
  return paintThinRegionPixels(
    pixels.data,
    thickness,
    settings.value.thresholdMicrons,
    appearance
  );
}
function paintProjection() {
  const result = projection.value;
  const target = canvas.value;
  highlightedPixels.value = 0;
  if (!target) return;
  const context = target.getContext('2d');
  if (!context) return;
  if (!result) {
    context.clearRect(0, 0, target.width, target.height);
    return;
  }
  target.width = result.width;
  target.height = result.height;
  const pixels = context.createImageData(result.width, result.height);
  paintProjectionIntensities(result.values, pixels.data, windowConfig.value);
  highlightedPixels.value = paintThinRegions(result, pixels);
  context.putImageData(pixels, 0, 0);
}
watch(
  [
    canvas,
    projection,
    () => windowConfig.value.width,
    () => windowConfig.value.level,
    () => settings.value.highlightThin,
    () => settings.value.thresholdMicrons,
    highlightReason,
    highlightAppearance,
  ],
  paintProjection,
  { flush: 'post' }
);

const stateMessage = computed(
  () =>
    projectionReason.value ||
    projectionError.value ||
    (computing.value ? 'Generating en face projection…' : null)
);
const state = computed(() =>
  projectionReason.value
    ? 'unavailable'
    : projectionError.value
      ? 'error'
      : computing.value
        ? 'computing'
        : projection.value
          ? 'ready'
          : 'unavailable'
);
const axisLabel = computed(() => ['X', 'Y', 'Z'][settings.value.axis]);
const methodLabel = computed(
  () => ({ mean: 'Mean', max: 'Maximum', sum: 'Sum' })[settings.value.method]
);
const sourceLoading = computed(
  () => currentImageID.value && imageCache.imageLoading[currentImageID.value]
);
</script>

<template>
  <div class="en-face-viewer" tabindex="0" data-testid="oct-en-face-viewer">
    <v-progress-linear
      v-if="computing || sourceLoading"
      indeterminate
      height="2"
      color="grey"
      class="loading-indicator"
    />
    <div ref="canvas-container" class="projection-display">
      <div class="projection-image" :style="canvasStyle">
        <canvas
          ref="canvas"
          tabindex="0"
          @pointerdown="startWindowing"
          @pointermove="moveWindowing"
          @pointerup="stopWindowing"
          @pointercancel="stopWindowing"
          @lostpointercapture="stopWindowing"
          :hidden="!projection"
          aria-label="OCT en face projection"
          data-testid="oct-en-face-canvas"
        />
        <svg
          v-if="projection"
          class="slice-position-lines"
          :viewBox="[0, 0, projection.width, projection.height].join(' ')"
          preserveAspectRatio="none"
          data-testid="oct-slice-lines"
        >
          <line
            v-for="line in sliceLines"
            :key="line.viewId"
            v-bind="line"
            :data-view-id="line.viewId"
            :data-x1="line.x1"
            :data-y1="line.y1"
            :data-x2="line.x2"
            :data-y2="line.y2"
            data-testid="oct-slice-line"
          />
        </svg>
      </div>
    </div>
    <div
      v-if="stateMessage"
      class="projection-status"
      role="status"
      aria-live="polite"
    >
      <span>{{ stateMessage }}</span>
      <v-btn
        v-if="projectionError && !projectionReason"
        size="small"
        variant="outlined"
        @click="retry += 1"
        >Retry projection</v-btn
      >
    </div>
    <ViewOverlayGrid class="overlay-no-events view-annotations">
      <template #top-left>
        <div class="annotation-cell">{{ currentImageMetadata.name }}</div>
      </template>
      <template #top-center
        ><div class="annotation-cell">
          En face • {{ axisLabel }} A-line
        </div></template
      >
      <template #top-right
        ><div class="annotation-cell">
          <DicomQuickInfoButton :image-id="currentImageID" /></div
      ></template>
      <template #bottom-left>
        <div
          class="annotation-cell projection-summary"
          role="status"
          data-testid="oct-en-face-state"
          :data-state="state"
          :data-projection-method="settings.method"
          :data-projection-axis="settings.axis"
          :data-slab-start="depthStart"
          :data-slab-end="depthEnd"
          :data-width="projection?.width ?? 0"
          :data-height="projection?.height ?? 0"
          :data-highlighted-pixels="highlightedPixels"
          :data-highlight-color="highlightAppearance?.color.join(',') ?? ''"
          :data-highlight-opacity="highlightAppearance?.alpha ?? 0"
          :data-window-width="windowConfig.width"
          :data-window-level="windowConfig.level"
        >
          <template v-if="projection"
            >{{ methodLabel }} • slab {{ depthStart }}–{{ depthEnd }}<br />{{
              projection.width
            }}
            × {{ projection.height
            }}<span v-if="settings.highlightThin && !highlightReason">
              • {{ highlightedPixels }} thin pixels (&lt;
              {{ settings.thresholdMicrons }} µm)</span
            ></template
          >
          <template v-else>{{ stateMessage }}</template>
        </div>
      </template>
      <template #bottom-right>
        <div class="annotation-cell corner-controls" @click.stop>
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
                variant="text"
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
              :projection-reason="projectionReason"
              :segmentation-reason="segmentationReason"
              :thickness-reason="highlightReason"
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
.projection-display {
  position: absolute;
  inset: 28px 16px 48px;
  display: flex;
  justify-content: center;
  align-items: center;
}
.projection-image {
  position: relative;
  flex: none;
}
.projection-image canvas,
.slice-position-lines {
  width: 100%;
  height: 100%;
  position: absolute;
  inset: 0;
}
.projection-image canvas {
  touch-action: none;
}
.slice-position-lines {
  pointer-events: none;
  overflow: hidden;
}
.slice-position-lines line {
  stroke: yellow;
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}
.projection-status {
  position: absolute;
  inset: 32px 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: white;
  text-align: center;
}
.corner-controls {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
}
.projection-summary {
  font-size: 0.75rem;
  letter-spacing: normal;
  white-space: normal;
}
</style>
