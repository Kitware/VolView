<template>
  <v-row justify="space-between" no-gutters>
    <v-btn
      variant="tonal"
      :prepend-icon="getPreviewButtonIcon()"
      @click="handlePreviewClick"
      :disabled="processStep === 'computing'"
      :loading="processStep === 'computing'"
    >
      {{ getPreviewButtonText() }}
    </v-btn>
    <v-btn
      variant="tonal"
      prepend-icon="mdi-check"
      :disabled="processStep !== 'previewing'"
      @click="confirmProcess"
    >
      Confirm
    </v-btn>
    <v-btn
      variant="tonal"
      prepend-icon="mdi-cancel"
      :disabled="processStep !== 'previewing'"
      @click="cancelProcess"
    >
      Cancel
    </v-btn>
  </v-row>
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

function handlePreviewClick() {
  if (processStep.value === 'start') {
    startCompute();
  } else if (processStep.value === 'previewing') {
    processStore.togglePreview();
  }
}

function getPreviewButtonText() {
  if (processStep.value === 'start') {
    return 'Preview';
  }
  if (processStep.value === 'previewing') {
    return showingOriginal.value ? 'Original' : 'Processed';
  }
  return 'Preview';
}

function getPreviewButtonIcon() {
  if (processStep.value === 'computing') {
    return '';
  }
  if (processStep.value === 'previewing') {
    return showingOriginal.value ? 'mdi-eye-settings' : 'mdi-eye-outline';
  }
  return 'mdi-cogs';
}

const confirmProcess = () => processStore.confirmProcess();
const cancelProcess = () => processStore.cancelProcess();
</script>
