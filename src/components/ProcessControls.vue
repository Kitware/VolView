<template>
  <ProcessTypeSelector />

  <template v-if="activeProcessType === ProcessType.FillBetween">
    <FillBetweenParameterControls />
    <ProcessWorkflow :algorithm="fillBetweenAlgorithm" />
  </template>

  <template v-if="activeProcessType === ProcessType.GaussianSmooth">
    <GaussianSmoothParameterControls />
    <ProcessWorkflow :algorithm="gaussianSmoothAlgorithm" />
  </template>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import {
  ProcessType,
  useProcessStore,
  type ProcessAlgorithm,
} from '../store/tools/process';
import ProcessTypeSelector from './ProcessTypeSelector.vue';
import ProcessWorkflow from './ProcessWorkflow.vue';
import FillBetweenParameterControls from './FillBetweenParameterControls.vue';
import GaussianSmoothParameterControls from './GaussianSmoothParameterControls.vue';
import { useFillBetweenStore } from '../store/tools/fillBetween';
import { useGaussianSmoothStore } from '../store/tools/gaussianSmooth';

const processStore = useProcessStore();
const fillBetweenStore = useFillBetweenStore();
const gaussianSmoothStore = useGaussianSmoothStore();

const activeProcessType = computed(() => processStore.activeProcessType);

// Create algorithm adapters for the ProcessWorkflow component
const fillBetweenAlgorithm: ProcessAlgorithm = {
  compute: async (segImage, activeSegment) => {
    return fillBetweenStore.computeAlgorithm(segImage, activeSegment);
  },
};

const gaussianSmoothAlgorithm: ProcessAlgorithm = {
  compute: async (segImage, activeSegment) => {
    return gaussianSmoothStore.computeAlgorithm(segImage, activeSegment);
  },
};
</script>
