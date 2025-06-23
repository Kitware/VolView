<template>
  <div class="mb-2 d-flex align-center">
    <mini-expansion-panel>
      <template #title>
        Smooth the selected segment using Gaussian filtering.
      </template>
      <ul>
        <li>
          Applies Gaussian smoothing to the currently selected segment only.
        </li>
        <li>Other segments in the labelmap remain unchanged.</li>
        <li>
          Higher sigma values create more smoothing effect but may reduce fine
          details.
        </li>
        <li>
          Background pixels may be added to the segment where confidence is high
          enough.
        </li>
      </ul>
    </mini-expansion-panel>
  </div>

  <v-row no-gutters class="mb-3">
    <v-col>
      <div class="mb-1">Smoothing Strength (σ)</div>
      <v-slider
        :model-value="sigma"
        @update:model-value="setSigma"
        :min="MIN_SIGMA"
        :max="MAX_SIGMA"
        :step="0.1"
        density="compact"
        hide-details
        thumb-label
      >
        <template v-slot:append>
          <v-text-field
            :model-value="sigma.toFixed(1)"
            @input="setSigma(parseFloat($event.target.value))"
            variant="underlined"
            class="mt-n3 pt-0 pl-2 opacity-70"
            style="width: 60px"
            density="compact"
            hide-details
            type="number"
            :min="MIN_SIGMA"
            :max="MAX_SIGMA"
            step="0.1"
          />
        </template>
      </v-slider>
    </v-col>
  </v-row>

  <v-row justify="space-between" no-gutters>
    <v-btn
      variant="tonal"
      :prepend-icon="smoothStep === 'computing' ? '' : 'mdi-blur'"
      @click="startCompute"
      :disabled="smoothStep !== 'start'"
      :loading="smoothStep === 'computing'"
    >
      Preview
    </v-btn>
    <v-btn
      variant="tonal"
      prepend-icon="mdi-check"
      :disabled="smoothStep !== 'previewing'"
      @click="confirmSmooth"
    >
      Confirm
    </v-btn>
    <v-btn
      variant="tonal"
      prepend-icon="mdi-cancel"
      :disabled="smoothStep !== 'previewing'"
      @click="cancelSmooth"
    >
      Cancel
    </v-btn>
  </v-row>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import MiniExpansionPanel from './MiniExpansionPanel.vue';
import { useGaussianSmoothStore } from '../store/tools/gaussianSmooth';
import { usePaintToolStore } from '../store/tools/paint';

const gaussianSmoothStore = useGaussianSmoothStore();
const paintStore = usePaintToolStore();

const smoothStep = computed(() => gaussianSmoothStore.smoothStep);
const sigma = computed(() => gaussianSmoothStore.sigma);

// Expose constants from store
const MIN_SIGMA = gaussianSmoothStore.MIN_SIGMA;
const MAX_SIGMA = gaussianSmoothStore.MAX_SIGMA;

function setSigma(value: number | string) {
  const numValue = typeof value === 'string' ? parseFloat(value) : value;
  if (!Number.isNaN(numValue)) {
    gaussianSmoothStore.setSigma(numValue);
  }
}

function startCompute() {
  const id = paintStore.activeSegmentGroupID;
  if (!id) return;
  gaussianSmoothStore.computeGaussianSmooth(id);
}

const confirmSmooth = () => gaussianSmoothStore.confirmSmooth();
const cancelSmooth = () => gaussianSmoothStore.cancelSmooth();
</script>
