<script setup lang="ts">
import { computed } from 'vue';
import LabelEditor from '@/src/components/LabelEditor.vue';
import type { LabelsStore } from '../store/tools/useLabels';
import type { AnnotationTool } from '../types/annotation-tool';

defineEmits([
  'done',
  'cancel',
  'delete',
  'update:name',
  'update:strokeWidth',
  'update:color',
]);

const props = defineProps<{
  name: string;
  strokeWidth: number;
  color: string;
  labelsStore: LabelsStore<Pick<AnnotationTool, 'strokeWidth'>>;
}>();

const existingNames = computed(
  () =>
    new Set(
      Object.values(props.labelsStore.labels).map((label) => label.labelName)
    )
);

function isUniqueEditingName(name: string) {
  return !existingNames.value.has(name);
}

function uniqueNameRule(name: string) {
  return isUniqueEditingName(name) || 'Name is not unique';
}
</script>

<template>
  <label-editor
    :color="color"
    @update:color="$emit('update:color', $event)"
    @cancel="$emit('cancel')"
    @done="$emit('done')"
    @delete="$emit('delete')"
  >
    <template #title>
      <v-card-title class="d-flex flex-row align-center">
        Edit Label
      </v-card-title>
    </template>
    <template #fields="{ done }">
      <v-text-field
        label="Name"
        class="flex-grow-0"
        :model-value="name"
        @update:model-value="$emit('update:name', $event)"
        @keydown.stop.enter="done"
        :rules="[uniqueNameRule]"
      />
      <v-text-field
        label="Stroke Width"
        type="number"
        class="flex-grow-0 label-stroke-width-input"
        :model-value="strokeWidth"
        @update:model-value="$emit('update:strokeWidth', +$event)"
        @keydown.stop.enter="done"
      />
    </template>
  </label-editor>
</template>
