<script setup lang="ts">
import LabelEditor from '@/src/components/LabelEditor.vue';
import { computed } from 'vue';

defineEmits([
  'done',
  'cancel',
  'delete',
  'update:name',
  'update:color',
  'update:fillOpacity',
  'update:outlineOpacity',
  'update:strokeWidth',
]);

const props = defineProps<{
  name: string;
  original: string;
  color: string;
  invalidNames: Set<string>;
  fillOpacity: number;
  outlineOpacity: number;
  strokeWidth: number;
}>();

function isUniqueEditingName(name: string) {
  const normalized = name.trim();
  return (
    normalized === props.original.trim() || !props.invalidNames.has(normalized)
  );
}

function uniqueNameRule(name: string) {
  return isUniqueEditingName(name) || 'Name is not unique';
}

const valid = computed(() => isUniqueEditingName(props.name));
</script>

<template>
  <label-editor
    :color="color"
    :valid="valid"
    @update:color="$emit('update:color', $event)"
    @delete="$emit('delete')"
    @cancel="$emit('cancel')"
    @done="$emit('done')"
  >
    <template #fields="{ done }">
      <v-text-field
        label="Name"
        class="flex-grow-0"
        :model-value="name"
        @update:model-value="$emit('update:name', $event)"
        @keydown.stop.enter="done"
        :rules="[uniqueNameRule]"
      />
      <v-slider
        class="mx-4 my-1"
        label="Fill Opacity"
        min="0"
        max="1"
        step="0.01"
        density="compact"
        hide-details
        thumb-label
        :model-value="fillOpacity"
        @update:model-value="$emit('update:fillOpacity', $event)"
      />
      <v-slider
        class="mx-4 my-1"
        label="Outline Opacity"
        min="0"
        max="1"
        step="0.01"
        density="compact"
        hide-details
        thumb-label
        :model-value="outlineOpacity"
        @update:model-value="$emit('update:outlineOpacity', $event)"
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
