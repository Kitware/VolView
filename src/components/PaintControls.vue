<template>
  <v-container>
    <v-row no-gutters align="center" justify="center" class="mb-4">
      <v-item-group
        v-model="mode"
        mandatory
        selected-class="selected"
        class="d-flex align-center justify-center"
      >
        <v-item
          :value="PaintMode.CirclePaint"
          v-slot="{ selectedClass, toggle }"
        >
          <v-btn
            variant="tonal"
            rounded="8"
            stacked
            :class="['mode-button', 'mx-2', selectedClass]"
            @click.stop="toggle"
          >
            <v-icon>mdi-brush</v-icon>
            <span class="text-caption">Paint</span>
          </v-btn>
        </v-item>
        <v-item :value="PaintMode.Erase" v-slot="{ selectedClass, toggle }">
          <v-btn
            variant="tonal"
            rounded="8"
            stacked
            :class="['mode-button', 'mx-2', selectedClass]"
            @click.stop="toggle"
          >
            <v-icon>mdi-eraser</v-icon>
            <span class="text-caption">Eraser</span>
          </v-btn>
        </v-item>
        <v-item :value="PaintMode.Process" v-slot="{ selectedClass, toggle }">
          <v-btn
            variant="tonal"
            rounded="8"
            stacked
            :class="['mode-button', 'mx-2', selectedClass]"
            @click.stop="toggle"
          >
            <v-icon>mdi-cogs</v-icon>
            <span class="text-caption">Process</span>
          </v-btn>
        </v-item>
      </v-item-group>
    </v-row>
    <template v-if="mode === PaintMode.CirclePaint || mode === PaintMode.Erase">
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
    </template>
    <template v-if="mode === PaintMode.Process">
      <v-row no-gutters align="center">
        <ProcessControls />
      </v-row>
    </template>
  </v-container>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { PaintMode } from '@/src/core/tools/paint';
import { usePaintToolStore } from '@/src/store/tools/paint';
import ProcessControls from '@/src/components/ProcessControls.vue';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { useImageStatsStore } from '@/src/store/image-stats';

const paintStore = usePaintToolStore();
const imageStatsStore = useImageStatsStore();
const { brushSize, activeMode, thresholdRange } = storeToRefs(paintStore);
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

const mode = computed({
  get: () => activeMode.value,
  set: (m) => {
    paintStore.setMode(m);
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
</style>
