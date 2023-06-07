<script setup lang="ts">
import { computed } from 'vue';
import { Labels, SetActiveLabel, useLabels } from '@/src/store/tools/useLabels';
import { AnnotationTool } from '@/src/types/annotationTool';

const props = defineProps<{
  labels: Labels<AnnotationTool>;
  activeLabel: ReturnType<typeof useLabels>['activeLabel']['value'];
  setActiveLabel: SetActiveLabel;
}>();

const labels = computed(() => Object.entries(props.labels));
// item groups need an index, not a value
const activeLabelIndex = computed(() => {
  return labels.value.findIndex(([name]) => name === props.activeLabel);
});
</script>

<template>
  <v-container>
    <v-card>
      <v-card-title class="pt-0">Labels</v-card-title>
      <v-item-group
        v-if="labels.length"
        :model-value="activeLabelIndex"
        selected-class="card-active"
      >
        <v-row>
          <v-col cols="6" v-for="[name, { color }] in labels" :key="name">
            <v-item v-slot="{ selectedClass, toggle }">
              <v-chip
                variant="tonal"
                :class="['w-100 px-2', selectedClass]"
                @click="
                  () => {
                    toggle();
                    setActiveLabel(name);
                  }
                "
              >
                <v-icon :color="color" size="18" class="mr-2">
                  mdi-square
                </v-icon>
                <span>{{ name }}</span>
              </v-chip>
            </v-item>
          </v-col>
        </v-row>
      </v-item-group>
      <div v-else class="text-caption text-center pa-2">
        No labels configured
      </div>
    </v-card>
  </v-container>
</template>

<style scoped>
.card-active {
  background-color: rgb(var(--v-theme-selection-bg-color));
  border-color: rgb(var(--v-theme-selection-border-color));
}
</style>
