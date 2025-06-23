<template>
  <v-row no-gutters align="center" justify="center" class="mb-4">
    <v-item-group
      v-model="activeProcessType"
      mandatory
      selected-class="selected"
      class="d-flex align-center justify-center"
    >
      <v-item
        :value="ProcessType.FillBetween"
        v-slot="{ selectedClass, toggle }"
      >
        <v-btn
          variant="tonal"
          rounded="8"
          stacked
          :class="['process-button', 'mx-2', selectedClass]"
          @click.stop="toggle"
        >
          <v-icon>mdi-layers-triple</v-icon>
          <span class="text-caption">Fill Between</span>
        </v-btn>
      </v-item>
      <v-item
        :value="ProcessType.GaussianSmooth"
        v-slot="{ selectedClass, toggle }"
      >
        <v-btn
          variant="tonal"
          rounded="8"
          stacked
          :class="['process-button', 'mx-2', selectedClass]"
          @click.stop="toggle"
        >
          <v-icon>mdi-blur</v-icon>
          <span class="text-caption">Smooth</span>
        </v-btn>
      </v-item>
    </v-item-group>
  </v-row>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { ProcessType, useProcessStore } from '../store/tools/process';

const processStore = useProcessStore();

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
