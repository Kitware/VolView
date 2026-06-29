<template>
  <v-row no-gutters class="mb-3 w-100">
    <div class="process-type-control">
      <v-menu location="bottom start">
        <template #activator="{ props }">
          <v-btn
            v-bind="props"
            variant="tonal"
            block
            spaced="end"
            class="process-type-menu-button"
            data-testid="process-type-selector"
            :prepend-icon="activeDefinition.icon"
            append-icon="mdi-menu-down"
            :disabled="isDisabled"
          >
            <span class="process-type-label">{{ activeDefinition.label }}</span>
          </v-btn>
        </template>

        <v-list density="compact">
          <v-list-item
            v-for="definition in PROCESS_DEFINITIONS"
            :key="definition.type"
            :active="activeProcessType === definition.type"
            :data-testid="`process-type-${definition.type}`"
            @click="activeProcessType = definition.type"
          >
            <template #prepend>
              <v-icon>{{ definition.icon }}</v-icon>
            </template>
            <v-list-item-title>{{ definition.label }}</v-list-item-title>
          </v-list-item>
        </v-list>
      </v-menu>
    </div>
  </v-row>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { usePaintProcessStore } from '@/src/store/tools/paintProcess';
import { PROCESS_DEFINITIONS } from './processes';

const processStore = usePaintProcessStore();

const isDisabled = computed(() => processStore.processStep !== 'start');
const activeProcessType = computed({
  get: () => processStore.activeProcessType,
  set: (processType) => {
    processStore.setActiveProcessType(processType);
  },
});
const activeDefinition = computed(
  () =>
    PROCESS_DEFINITIONS.find(
      (def) => def.type === processStore.activeProcessType
    ) ?? PROCESS_DEFINITIONS[0]
);
</script>

<style scoped>
.process-type-control {
  width: 100%;
}

.process-type-menu-button {
  justify-content: start;
  min-height: 40px;
}

.process-type-label {
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
