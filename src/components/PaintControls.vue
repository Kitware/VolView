<template>
  <v-container class="pa-0">
    <v-expansion-panels
      v-model="controlPanels"
      multiple
      variant="accordion"
      class="paint-process-panels"
    >
      <v-expansion-panel :value="PAINT_PANEL">
        <v-expansion-panel-title>
          <v-icon class="flex-grow-0 mr-4">mdi-brush</v-icon>
          Paint
        </v-expansion-panel-title>
        <v-expansion-panel-text class="control-panel-body">
          <v-row no-gutters align="center" justify="start" class="mb-4">
            <v-item-group
              v-model="interactionMode"
              mandatory
              selected-class="selected"
              class="d-flex align-center justify-start ga-4"
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
                  :disabled="!isPaintingModeActive"
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
                  :disabled="!isPaintingModeActive"
                  @click.stop="toggle"
                >
                  <v-icon>mdi-eraser</v-icon>
                  <span class="text-caption">Erase</span>
                </v-btn>
              </v-item>
            </v-item-group>
          </v-row>

          <v-row no-gutters align="center" class="mb-2">
            <span class="mr-2">Sync Views</span>
            <v-switch
              v-model="crossPlaneSync"
              color="primary"
              density="compact"
              hide-details
              class="ml-3"
            ></v-switch>
          </v-row>
          <v-row no-gutters>Size (pixels)</v-row>
          <v-row no-gutters align="center">
            <v-slider
              :model-value="brushSize"
              @update:model-value="setBrushSize"
              density="compact"
              hide-details
              min="1"
              max="50"
            >
              <template v-slot:append>
                <v-text-field
                  :model-value="brushSize"
                  @input="setBrushSize"
                  variant="underlined"
                  class="mt-n3 pt-0 pl-2 opacity-70"
                  style="width: 60px"
                  density="compact"
                  hide-details
                  type="number"
                  min="1"
                  max="50"
                />
              </template>
            </v-slider>
          </v-row>
          <v-row no-gutters class="mb-1">Threshold </v-row>
          <v-row v-if="currentImageStats" no-gutters align="center">
            <v-range-slider
              v-model="threshold"
              :min="currentImageStats.scalarMin"
              :max="currentImageStats.scalarMax"
              :step="thresholdStepGranularity"
            >
              <template #prepend>
                <v-text-field
                  :model-value="thresholdRange[0].toFixed(2)"
                  @input="setMinThreshold($event.target.value)"
                  variant="underlined"
                  class="mt-n3 pt-0 pl-2 opacity-70"
                  style="width: 80px"
                  density="compact"
                  hide-details
                  type="number"
                  precision="2"
                  :min="currentImageStats.scalarMin"
                  :max="thresholdRange[1]"
                />
              </template>
              <template #append>
                <v-text-field
                  :model-value="thresholdRange[1].toFixed(2)"
                  @input="setMaxThreshold($event.target.value)"
                  variant="underlined"
                  class="mt-n3 pt-0 pl-2 opacity-70"
                  style="width: 80px"
                  density="compact"
                  hide-details
                  type="number"
                  precision="2"
                  :min="thresholdRange[0]"
                  :max="currentImageStats.scalarMax"
                />
              </template>
            </v-range-slider>
          </v-row>
        </v-expansion-panel-text>
      </v-expansion-panel>

      <v-expansion-panel :value="PROCESS_PANEL">
        <v-expansion-panel-title>
          <v-icon class="flex-grow-0 mr-4">mdi-cogs</v-icon>
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
import { computed, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { PaintMode } from '@/src/core/tools/paint';
import { usePaintToolStore } from '@/src/store/tools/paint';
import { usePaintProcessStore } from '@/src/store/tools/paintProcess';
import ProcessControls from '@/src/components/ProcessControls.vue';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { useImageStatsStore } from '@/src/store/image-stats';

const paintStore = usePaintToolStore();
const processStore = usePaintProcessStore();
const imageStatsStore = useImageStatsStore();
const PAINT_PANEL = 'paint';
const PROCESS_PANEL = 'process';
const paintControlsOpen = ref(true);
const { setProcessControlsOpen } = paintStore;
const {
  brushSize,
  activePaintMode,
  processControlsOpen,
  isPaintingModeActive,
  thresholdRange,
  crossPlaneSync,
} = storeToRefs(paintStore);
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

const interactionMode = computed({
  get: () => activePaintMode.value,
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

.paint-process-panels {
  width: 100%;
}

.control-panel-body :deep(.v-expansion-panel-text__wrapper) {
  padding: 12px 14px 16px;
}
</style>
