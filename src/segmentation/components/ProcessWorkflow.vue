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
      <reasoned-action
        v-if="processStep === 'start' || processStep === 'computing'"
        :reason="startDisabledReason"
        v-slot="{ disabled }"
      >
        <v-btn
          variant="tonal"
          prepend-icon="mdi-cogs"
          @click="startCompute"
          :loading="processStep === 'computing'"
          :disabled="processStep === 'computing' || disabled"
        >
          Preview
        </v-btn>
      </reasoned-action>

      <v-btn-toggle
        v-if="processStep === 'previewing'"
        :model-value="showingOriginal ? 0 : 1"
        mandatory
        variant="outlined"
        divided
        density="compact"
      >
        <!-- A mandatory toggle keeps its selection when the selected button
             is clicked again, but still fires the click, so each button states
             what it shows rather than flipping the preview. -->
        <v-btn :value="0" @click="processStore.setShowingOriginal(true)">
          <v-icon start>mdi-eye-outline</v-icon>
          Original
        </v-btn>
        <v-btn :value="1" @click="processStore.setShowingOriginal(false)">
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
import ReasonedAction from '@/src/components/ReasonedAction.vue';
import {
  usePaintProcessStore,
  type ProcessAlgorithm,
} from '@/src/segmentation/editing/paintProcess';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { useToolStore } from '@/src/store/tools';
import { Tools } from '@/src/store/tools/types';

interface Props {
  algorithm: ProcessAlgorithm;
  requiresActiveSegment?: boolean;
  label?: string;
}

const props = withDefaults(defineProps<Props>(), {
  requiresActiveSegment: true,
});

const processStore = usePaintProcessStore();

const processStep = computed(() => processStore.processStep);
const showingOriginal = computed(() => processStore.showingOriginal);
const { currentImageID } = useCurrentImage('global');
const toolStore = useToolStore();
// A preview belongs to the paint tool, which cancels it when put down.
const startDisabledReason = computed(() => {
  if (processStep.value !== 'start') return '';
  if (toolStore.paintUnavailableReason) return toolStore.paintUnavailableReason;
  if (toolStore.currentTool !== Tools.Paint)
    return 'Select the Paint tool to run a process';
  return processStore.startRefusal(
    currentImageID.value,
    props.requiresActiveSegment
  );
});

function startCompute() {
  processStore.startProcess(props.algorithm, {
    requiresActiveSegment: props.requiresActiveSegment,
    label: props.label,
  });
}

function handleCancel() {
  processStore.cancelProcess();
}

function handleApply() {
  processStore.confirmProcess();
}
</script>
