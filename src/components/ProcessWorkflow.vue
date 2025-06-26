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
    </v-row>

    <v-row
      v-if="processStep === 'previewing'"
      justify="center"
      no-gutters
      class="align-center ga-2 mt-2"
    >
      <v-btn prepend-icon="mdi-close" variant="tonal" @click="handleCancel">
        Cancel
      </v-btn>

      <v-btn prepend-icon="mdi-check" variant="tonal" @click="handleApply">
        Apply
      </v-btn>
    </v-row>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { usePaintToolStore } from '@/src/store/tools/paint';
import {
  usePaintProcessStore,
  type ProcessAlgorithm,
} from '@/src/store/tools/paintProcess';

interface Props {
  algorithm: ProcessAlgorithm;
}

const props = defineProps<Props>();

const processStore = usePaintProcessStore();
const paintStore = usePaintToolStore();

const processStep = computed(() => processStore.processStep);
const showingOriginal = computed(() => processStore.showingOriginal);

function startCompute() {
  const id = paintStore.activeSegmentGroupID;
  if (!id) return;
  processStore.startProcess(id, props.algorithm);
}

function handleToggleChange(value: number) {
  const shouldShowOriginal = value === 0;
  if (shouldShowOriginal !== showingOriginal.value) {
    processStore.togglePreview();
  }
}

function handleCancel() {
  processStore.cancelProcess();
}

function handleApply() {
  processStore.confirmProcess();
}
</script>
