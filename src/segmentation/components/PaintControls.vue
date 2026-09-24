<template>
  <v-container class="pa-0">
    <v-expansion-panels
      v-model="controlPanels"
      multiple
      variant="accordion"
      class="annotation-panels paint-process-panels"
    >
      <v-expansion-panel :value="PAINT_PANEL">
        <v-expansion-panel-title>
          <v-icon class="annotation-panel-icon">mdi-brush</v-icon>
          Paint
        </v-expansion-panel-title>
        <v-expansion-panel-text class="control-panel-body">
          <v-row
            no-gutters
            align="center"
            justify="start"
            class="mb-4"
            :tabindex="modeDisabledReason ? 0 : undefined"
          >
            <v-tooltip
              :eager="false"
              :disabled="!modeDisabledReason"
              activator="parent"
              location="top"
            >
              {{ modeDisabledReason }}
            </v-tooltip>
            <v-item-group
              v-model="interactionMode"
              mandatory
              selected-class="selected"
              class="d-flex flex-wrap align-center justify-start ga-2"
            >
              <v-item
                :value="PaintMode.CirclePaint"
                v-slot="{ selectedClass, toggle }"
              >
                <v-btn
                  variant="tonal"
                  rounded="8"
                  stacked
                  :class="['mode-button', selectedClass]"
                  :disabled="!!modeDisabledReason"
                  @click.stop="toggle"
                >
                  <v-icon>mdi-brush</v-icon>
                  <span class="text-caption">Paint</span>
                </v-btn>
              </v-item>
              <v-item
                :value="PaintMode.Erase"
                v-slot="{ selectedClass, toggle }"
              >
                <v-btn
                  variant="tonal"
                  rounded="8"
                  stacked
                  :class="['mode-button', selectedClass]"
                  :disabled="!!modeDisabledReason"
                  @click.stop="toggle"
                >
                  <v-icon>mdi-eraser</v-icon>
                  <span class="text-caption">Erase</span>
                </v-btn>
              </v-item>
              <v-item
                :value="PaintMode.Eyedropper"
                v-slot="{ selectedClass, toggle }"
              >
                <span>
                  <v-btn
                    variant="tonal"
                    rounded="8"
                    stacked
                    :class="['mode-button', selectedClass]"
                    :disabled="!!modeDisabledReason"
                    :aria-pressed="interactionMode === PaintMode.Eyedropper"
                    data-testid="paint-eyedropper-button"
                    @click.stop="toggle"
                  >
                    <v-icon>mdi-eyedropper</v-icon>
                    <span class="text-caption">Eyedropper</span>
                  </v-btn>
                  <v-tooltip
                    :eager="false"
                    :disabled="!!modeDisabledReason"
                    activator="parent"
                    location="top"
                  >
                    Pick a label map segment. Hold {{ eyedropperShortcut }} for
                    temporary use.
                  </v-tooltip>
                </span>
              </v-item>
            </v-item-group>
          </v-row>

          <div
            class="paint-parameters"
            :tabindex="brushDisabledReason ? 0 : undefined"
          >
            <v-tooltip
              :eager="false"
              :disabled="!brushDisabledReason"
              activator="parent"
              location="top"
            >
              {{ brushDisabledReason }}
            </v-tooltip>
            <span class="control-label text-body-2 text-no-wrap">
              <v-icon size="small">mdi-diameter-outline</v-icon>Size
            </span>
            <v-slider
              name="Brush size"
              :disabled="!!brushDisabledReason"
              :model-value="brushSize"
              @update:model-value="setBrushSize"
              density="compact"
              hide-details
              min="1"
              max="50"
              step="1"
            />
            <span class="control-label text-body-2 text-no-wrap">
              <v-icon size="small">mdi-chart-histogram</v-icon>Threshold
            </span>
            <v-range-slider
              v-if="currentImageStats"
              v-threshold-thumb-labels
              class="threshold-control"
              :disabled="!!brushDisabledReason"
              v-model="threshold"
              :min="currentImageStats.scalarMin"
              :max="currentImageStats.scalarMax"
              :step="thresholdStepGranularity"
            >
              <template #prepend>
                <v-text-field
                  aria-label="Minimum threshold"
                  :disabled="!!brushDisabledReason"
                  :model-value="thresholdRange[0].toFixed(2)"
                  @input="setMinThreshold($event.target.value)"
                  variant="underlined"
                  class="threshold-input pl-2 opacity-70"
                  style="width: 80px"
                  density="compact"
                  hide-details
                  hide-spin-buttons
                  type="number"
                  precision="2"
                  :min="currentImageStats.scalarMin"
                  :max="thresholdRange[1]"
                />
              </template>
              <template #append>
                <v-text-field
                  aria-label="Maximum threshold"
                  :disabled="!!brushDisabledReason"
                  :model-value="thresholdRange[1].toFixed(2)"
                  @input="setMaxThreshold($event.target.value)"
                  variant="underlined"
                  class="threshold-input pl-2 opacity-70"
                  style="width: 80px"
                  density="compact"
                  hide-details
                  hide-spin-buttons
                  type="number"
                  precision="2"
                  :min="thresholdRange[0]"
                  :max="currentImageStats.scalarMax"
                />
              </template>
            </v-range-slider>
          </div>
          <div class="paint-switches mb-2">
            <div class="d-flex align-center">
              <label
                :for="overlapSwitchId"
                class="control-label text-body-2 text-no-wrap cursor-pointer"
              >
                <v-icon size="small">mdi-set-center</v-icon>Allow Overlap
              </label>
              <v-switch
                :id="overlapSwitchId"
                aria-label="Allow Overlap"
                v-model="allowOverlap"
                color="primary"
                density="compact"
                hide-details
                class="ml-3 flex-grow-0"
              ></v-switch>
              <v-tooltip :eager="false" activator="parent" location="top">
                On: painting and rasterizing keep other segments' voxels, so
                segments overlap. Off: they take voxels from unlocked segments
                and go around locked ones.
              </v-tooltip>
            </div>
            <div
              class="d-flex align-center"
              :tabindex="brushDisabledReason ? 0 : undefined"
            >
              <label
                :for="syncSwitchId"
                :class="[
                  'control-label text-body-2 text-no-wrap',
                  { 'cursor-pointer': !brushDisabledReason },
                ]"
              >
                <v-icon size="small">mdi-link-variant</v-icon>Sync Views
              </label>
              <v-tooltip
                :eager="false"
                :disabled="!brushDisabledReason"
                activator="parent"
                location="top"
              >
                {{ brushDisabledReason }}
              </v-tooltip>
              <v-switch
                :id="syncSwitchId"
                aria-label="Sync Views"
                :disabled="!!brushDisabledReason"
                v-model="crossPlaneSync"
                color="primary"
                density="compact"
                hide-details
                class="ml-3 flex-grow-0"
              ></v-switch>
            </div>
          </div>
        </v-expansion-panel-text>
      </v-expansion-panel>

      <v-expansion-panel :value="PROCESS_PANEL">
        <v-expansion-panel-title>
          <v-icon class="annotation-panel-icon">mdi-cogs</v-icon>
          Process
        </v-expansion-panel-title>
        <v-expansion-panel-text class="control-panel-body">
          <ProcessControls />
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>
  </v-container>
</template>

<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { PaintMode } from '@/src/core/tools/paint';
import { usePaintInteractionMode } from '@/src/segmentation/composables/usePaintInteractionMode';
import {
  actionToKey,
  readableBinding,
} from '@/src/composables/useKeyboardShortcuts';
import { usePaintToolStore } from '@/src/store/tools/paint';
import { useToolStore } from '@/src/store/tools';
import { Tools } from '@/src/store/tools/types';
import { usePaintProcessStore } from '@/src/segmentation/editing/paintProcess';
import { useSegmentationStore } from '@/src/segmentation/store';
import ProcessControls from '@/src/components/ProcessControls.vue';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { useImageStatsStore } from '@/src/store/image-stats';

const setThresholdThumbLabels = (element: HTMLElement) => {
  // VRangeSlider has no endpoint-name props, so label its two focus targets.
  const thumbs = element.querySelectorAll<HTMLElement>('[role="slider"]');
  thumbs[0]?.setAttribute('aria-label', 'Minimum threshold');
  thumbs[1]?.setAttribute('aria-label', 'Maximum threshold');
};

const vThresholdThumbLabels = {
  mounted: setThresholdThumbLabels,
  updated: setThresholdThumbLabels,
};

const paintStore = usePaintToolStore();
const processStore = usePaintProcessStore();
const imageStatsStore = useImageStatsStore();
const PAINT_PANEL = 'paint';
const PROCESS_PANEL = 'process';
const toolStore = useToolStore();
const paintToolActive = computed(() => toolStore.currentTool === Tools.Paint);
// Picking up the brush shows its controls; closing them again is the user's call.
const paintControlsOpen = ref(paintToolActive.value);
watch(paintToolActive, (active) => {
  if (active) paintControlsOpen.value = true;
});
const { setProcessControlsOpen } = paintStore;
const {
  brushSize,
  processControlsOpen,
  isPaintingModeActive,
  thresholdRange,
  crossPlaneSync,
} = storeToRefs(paintStore);
const { allowOverlap } = storeToRefs(useSegmentationStore());
const overlapSwitchId = useId();
const syncSwitchId = useId();
// Allow Overlap stays live: it also governs a polygon's Rasterize.
const brushDisabledReason = computed(() =>
  paintToolActive.value ? '' : 'Select the Paint tool to adjust the brush'
);
const modeDisabledReason = computed(() => {
  if (!paintToolActive.value)
    return 'Select the Paint tool to paint, erase or pick a segment';
  return isPaintingModeActive.value
    ? ''
    : 'Finish processing to paint, erase or pick a segment';
});
const { currentImageID } = useCurrentImage();

const currentImageStats = computed(() => {
  if (!currentImageID.value) return null;
  return imageStatsStore.stats[currentImageID.value] ?? null;
});
const thresholdStepGranularity = computed(() => {
  if (!currentImageStats.value) return 1;
  const { scalarMin, scalarMax } = currentImageStats.value;
  return Math.min(1, (scalarMax - scalarMin) / 256);
});
const isProcessActive = computed(() => processStore.processStep !== 'start');
const threshold = computed({
  get: () => thresholdRange.value,
  set: (range) => {
    paintStore.setThresholdRange(range);
  },
});

const setMinThreshold = (n: string) => {
  threshold.value = [+n, threshold.value[1]];
};

const setMaxThreshold = (n: string) => {
  threshold.value = [threshold.value[0], +n];
};

const setBrushSize = (size: number) => {
  paintStore.setBrushSize(Number(size));
};

const effectiveMode = usePaintInteractionMode();
const eyedropperShortcut = computed(() =>
  readableBinding(actionToKey.value.paintEyedropper)
);
const interactionMode = computed({
  get: () => effectiveMode.value,
  set: (m) => {
    paintStore.setMode(m);
  },
});
const controlPanels = computed({
  get: () => [
    ...(paintControlsOpen.value ? [PAINT_PANEL] : []),
    ...(processControlsOpen.value ? [PROCESS_PANEL] : []),
  ],
  set: (panels) => {
    paintControlsOpen.value = panels.includes(PAINT_PANEL);
    if (isProcessActive.value) {
      setProcessControlsOpen(true);
      return;
    }
    setProcessControlsOpen(panels.includes(PROCESS_PANEL));
  },
});
</script>

<style scoped>
.selected {
  background-color: rgb(var(--v-theme-selection-bg-color));
  border-color: rgb(var(--v-theme-selection-border-color));
}

.mode-button {
  min-height: 56px;
  min-width: 110px;
  height: 56px;
  width: 110px;
}

.paint-parameters {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  column-gap: 12px;
  align-items: center;
}

.threshold-input :deep(input) {
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
}

.threshold-control {
  margin-top: 8px;
}

.control-label {
  display: inline-flex;
  align-items: center;
  column-gap: 6px;
}

.control-label .v-icon {
  opacity: 0.7;
}

.paint-switches {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  column-gap: 24px;
}
</style>
