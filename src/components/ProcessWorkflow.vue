<template>
  <div class="d-flex flex-column align-start w-100">
    <v-row
      justify="start"
      no-gutters
      :class="[
        'align-center',
        'ga-2',
        { 'mb-4': processStep === 'previewing' },
      ]"
    >
      <v-btn
        v-if="processStep === 'start' || processStep === 'computing'"
        variant="tonal"
        prepend-icon="mdi-cogs"
        @click="startCompute"
        :loading="processStep === 'computing'"
        :disabled="processStep === 'computing'"
      >
        Preview
      </v-btn>

      <v-btn-toggle
        v-if="processStep === 'previewing'"
        :model-value="showingOriginal ? 0 : 1"
        mandatory
        variant="outlined"
        divided
        density="compact"
      >
        <v-btn :value="0" @click="processStore.togglePreview()">
          <v-icon start>mdi-eye-outline</v-icon>
          Original
        </v-btn>
        <v-btn :value="1" @click="processStore.togglePreview()">
          <v-icon start>mdi-eye-settings</v-icon>
          Processed
        </v-btn>
      </v-btn-toggle>
    </v-row>

    <v-row
      v-if="processStep === 'previewing'"
      justify="start"
      no-gutters
      class="align-center ga-2"
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
  requiresActiveSegment?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  requiresActiveSegment: true,
});

const processStore = usePaintProcessStore();
const paintStore = usePaintToolStore();

const processStep = computed(() => processStore.processStep);
const showingOriginal = computed(() => processStore.showingOriginal);

function startCompute() {
  const id = paintStore.activeSegmentGroupID;
  if (!id) return;
  processStore.startProcess(id, props.algorithm, {
    requiresActiveSegment: props.requiresActiveSegment,
  });
}

function handleCancel() {
  processStore.cancelProcess();
}

function handleApply() {
  processStore.confirmProcess();
}
</script>
