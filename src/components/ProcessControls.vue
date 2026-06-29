<template>
  <div class="d-flex flex-column align-start w-100">
    <ProcessTypeSelector />

    <template v-if="activeDefinition">
      <div class="process-settings">
        <component :is="activeDefinition.controls" />
        <ProcessWorkflow
          :algorithm="activeDefinition.getAlgorithm()"
          :requires-active-segment="
            activeDefinition.requiresActiveSegment?.() ?? true
          "
        />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { usePaintProcessStore } from '@/src/store/tools/paintProcess';
import ProcessTypeSelector from './ProcessTypeSelector.vue';
import ProcessWorkflow from './ProcessWorkflow.vue';
import { PROCESS_DEFINITIONS } from './processes';

const processStore = usePaintProcessStore();

const activeDefinition = computed(() =>
  PROCESS_DEFINITIONS.find((def) => def.type === processStore.activeProcessType)
);
</script>

<style scoped>
.process-settings {
  width: 100%;
}
</style>
