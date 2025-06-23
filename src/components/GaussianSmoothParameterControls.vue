<template>
  <div class="d-flex align-center">
    <mini-expansion-panel>
      <template #title>Gaussian smooth selected segment.</template>
      <ul>
        <li>
          Applies label-preserving Gaussian smoothing to reduce noise and smooth
          boundaries.
        </li>
        <li>
          Each label is processed separately to prevent mixing between different
          segments.
        </li>
        <li>
          Higher sigma values create more smoothing effect but may reduce fine
          details.
        </li>
      </ul>
    </mini-expansion-panel>
  </div>

  <v-slider
    class="mb-4"
    label="Smoothing Strength (σ)"
    :min="MIN_SIGMA"
    :max="MAX_SIGMA"
    :step="0.1"
    density="compact"
    hide-details
    thumb-label
    :model-value="sigma"
    @update:model-value="setSigma"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import MiniExpansionPanel from './MiniExpansionPanel.vue';
import { useGaussianSmoothStore } from '../store/tools/gaussianSmooth';

const gaussianSmoothStore = useGaussianSmoothStore();

const sigma = computed(() => gaussianSmoothStore.sigma);
const { MIN_SIGMA, MAX_SIGMA, setSigma } = gaussianSmoothStore;
</script>
