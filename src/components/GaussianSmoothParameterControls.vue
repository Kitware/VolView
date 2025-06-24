<template>
  <div class="d-flex align-center">
    <mini-expansion-panel>
      <template #title>Gaussian smooth selected segment.</template>
      <ul>
        <li>
          Applies Gaussian smoothing to reduce noise and smooth boundaries.
        </li>
        <li>Only the selected segment will be smoothed.</li>
        <li>
          Higher sigma values create more smoothing effect but may reduce fine
          details.
        </li>
      </ul>
    </mini-expansion-panel>
  </div>

  <div class="w-100 mb-4">
    <v-slider
      class="mx-4"
      label="Smoothing Strength (σ)"
      :min="MIN_SIGMA"
      :max="MAX_SIGMA"
      :step="0.1"
      density="compact"
      hide-details
      thumb-label
      :model-value="sigma"
      :disabled="isDisabled"
      @update:model-value="setSigma"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import MiniExpansionPanel from './MiniExpansionPanel.vue';
import { useGaussianSmoothStore } from '../store/tools/gaussianSmooth';
import { useProcessStore } from '../store/tools/process';

const gaussianSmoothStore = useGaussianSmoothStore();
const processStore = useProcessStore();

const sigma = computed(() => gaussianSmoothStore.sigma);
const isDisabled = computed(() => processStore.processStep === 'previewing');
const { MIN_SIGMA, MAX_SIGMA, setSigma } = gaussianSmoothStore;
</script>
