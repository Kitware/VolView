<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';
import { Labels, SetActiveLabel, useLabels } from '@/src/store/tools/useLabels';
import { AnnotationTool } from '@/src/types/annotationTool';

const props = defineProps<{
  labels: Labels<AnnotationTool>;
  activeLabel: ReturnType<typeof useLabels>['activeLabel']['value'];
  setActiveLabel: SetActiveLabel;
}>();

const handleKeyDown = (event: KeyboardEvent) => {
  let offset = 0;
  if (event.key === 'q') {
    offset = -1;
  }
  if (event.key === 'w') {
    offset = 1;
  }

  const labels = Object.entries(props.labels);
  const labelIndex = labels.findIndex(([name]) => name === props.activeLabel);
  const [nextLabel] = labels.at((labelIndex + offset) % labels.length)!;
  props.setActiveLabel(nextLabel);
};

onMounted(() => {
  window.addEventListener('keydown', handleKeyDown);
});
onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown);
});
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
          v-for="({ color }, name) in labels"
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
