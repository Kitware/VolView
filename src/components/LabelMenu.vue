<script setup lang="ts">
import { Labels, SetActiveLabel } from '@/src/store/tools/useLabels';

defineProps<{
  labels: Labels;
  activeLabel: string;
  setActiveLabel: SetActiveLabel;
}>();
</script>

<template>
  <v-card class="menu-content">
    <v-card-text>
      <v-radio-group
        v-if="Object.keys(labels).length > 0"
        :model-value="activeLabel"
        @update:model-value="setActiveLabel"
        class="mt-0"
        hide-details
      >
        <v-radio
          v-for="(color, name) in labels"
          :key="name"
          :label="name"
          :value="name"
          class="full-icon-opacity"
        >
          <template v-slot:label>
            <v-icon :color="color" size="18" class="pr-2"> mdi-square </v-icon>
            <span>{{ name }}</span>
          </template>
        </v-radio>
      </v-radio-group>
      <div v-else>No labels configured</div>
    </v-card-text>
  </v-card>
</template>

<style>
/* avoid washed out color square */
.full-icon-opacity .v-label,
.full-icon-opacity .v-label .v-icon {
  opacity: 1;
}
.full-icon-opacity .v-label > * {
  opacity: var(--v-medium-emphasis-opacity);
}
</style>
