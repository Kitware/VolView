<template>
  <div class="d-flex flex-column align-center">
    <v-row justify="center" no-gutters class="align-center ga-2">
      <v-btn
        v-if="processStep === 'start' || processStep === 'computing'"
        variant="tonal"
        prepend-icon="mdi-cogs"
        @click="startCompute"
        :loading="processStep === 'computing'"
        :disabled="processStep === 'computing'"
        size="small"
      >
        Preview
      </v-btn>

      <v-btn-toggle
        v-if="processStep === 'previewing'"
        :model-value="showingOriginal ? 0 : 1"
        @update:model-value="handleToggleChange"
        mandatory
        variant="outlined"
        divided
        density="compact"
      >
        <v-btn :value="0" size="small">
          <v-icon start size="small">mdi-eye-outline</v-icon>
          Original
        </v-btn>
        <v-btn :value="1" size="small">
          <v-icon start size="small">mdi-eye-settings</v-icon>
          Processed
        </v-btn>
      </v-btn-toggle>

      <v-btn
        variant="tonal"
        prepend-icon="mdi-check"
        @click="handleConfirm"
        :disabled="processStep !== 'previewing'"
        size="small"
      >
        Choose
      </v-btn>
    </v-row>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useProcessStore, type ProcessAlgorithm } from '../store/tools/process';
import { usePaintToolStore } from '../store/tools/paint';

interface Props {
  algorithm: ProcessAlgorithm;
}

const props = defineProps<Props>();

const processStore = useProcessStore();
const paintStore = usePaintToolStore();

const processStep = computed(() => processStore.processStep);
const showingOriginal = computed(() => processStore.showingOriginal);

function startCompute() {
  const id = paintStore.activeSegmentGroupID;
  if (!id) return;
  processStore.computeProcess(id, props.algorithm);
}

function handleToggleChange(value: number | string) {
  const numValue = typeof value === 'string' ? parseInt(value, 10) : value;
  const shouldShowOriginal = numValue === 0;
  if (shouldShowOriginal !== showingOriginal.value) {
    processStore.togglePreview();
  }
}

function handleConfirm() {
  if (showingOriginal.value) {
    // User is viewing original - cancel the process
    processStore.cancelProcess();
  } else {
    // User is viewing processed - confirm the process
    processStore.confirmProcess();
  }
}
</script>
