<template>
  <v-row no-gutters align="center" justify="center" class="mb-4">
    <v-item-group
      v-model="activeProcessType"
      mandatory
      selected-class="selected"
      class="d-flex align-center justify-center flex-wrap"
    >
      <v-item
        v-for="definition in PROCESS_DEFINITIONS"
        :key="definition.type"
        :value="definition.type"
        v-slot="{ selectedClass, toggle }"
      >
        <v-btn
          variant="tonal"
          rounded="8"
          stacked
          :class="['process-button', 'mx-2', selectedClass]"
          @click.stop="toggle"
        >
          <v-icon>{{ definition.icon }}</v-icon>
          <span class="text-caption">{{ definition.label }}</span>
        </v-btn>
      </v-item>
    </v-item-group>
  </v-row>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { usePaintProcessStore } from '@/src/store/tools/paintProcess';
import { PROCESS_DEFINITIONS } from './processes';

const processStore = usePaintProcessStore();

const activeProcessType = computed({
  get: () => processStore.activeProcessType,
  set: (type) => {
    processStore.setActiveProcessType(type);
  },
});
</script>

<style scoped>
.selected {
  background-color: rgb(var(--v-theme-selection-bg-color));
  border-color: rgb(var(--v-theme-selection-border-color));
}

.process-button {
  min-height: 56px;
  min-width: 110px;
  height: 56px;
  width: 110px;
}
</style>
