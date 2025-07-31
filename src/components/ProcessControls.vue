<template>
  <div class="d-flex flex-column align-center w-100">
    <ProcessTypeSelector />

    <template v-if="activeProcessType === ProcessType.FillBetween">
      <FillBetweenParameterControls />
      <ProcessWorkflow :algorithm="fillBetweenAlgorithm" />
    </template>

    <template v-if="activeProcessType === ProcessType.GaussianSmooth">
      <GaussianSmoothParameterControls />
      <ProcessWorkflow :algorithm="gaussianSmoothAlgorithm" />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import {
  ProcessType,
  usePaintProcessStore,
} from '@/src/store/tools/paintProcess';
import ProcessTypeSelector from './ProcessTypeSelector.vue';
import ProcessWorkflow from './ProcessWorkflow.vue';
import FillBetweenParameterControls from './FillBetweenParameterControls.vue';
import GaussianSmoothParameterControls from './GaussianSmoothParameterControls.vue';
import { useFillBetweenStore } from '../store/tools/fillBetween';
import { useGaussianSmoothStore } from '../store/tools/gaussianSmooth';

const processStore = usePaintProcessStore();
const fillBetweenStore = useFillBetweenStore();
const gaussianSmoothStore = useGaussianSmoothStore();

const activeProcessType = computed(() => processStore.activeProcessType);

const fillBetweenAlgorithm = fillBetweenStore.computeAlgorithm;
const gaussianSmoothAlgorithm = gaussianSmoothStore.computeAlgorithm;
</script>
