<script setup lang="ts">
import LabelEditor from '@/src/components/LabelEditor.vue';
import { computed } from 'vue';

defineEmits([
  'done',
  'cancel',
  'delete',
  'update:name',
  'update:color',
  'update:opacity',
]);

const props = defineProps<{
  name: string;
  color: string;
  invalidNames: Set<string>;
  opacity: number;
}>();

function isUniqueEditingName(name: string) {
  return !props.invalidNames.has(name.trim());
}

function uniqueNameRule(name: string) {
  return isUniqueEditingName(name) || 'Name is not unique';
}

const valid = computed(() => {
  return isUniqueEditingName(props.name);
});
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
        label="Segment Fill Opacity"
        min="0"
        max="1"
        step="0.01"
        density="compact"
        hide-details
        thumb-label
        :model-value="opacity"
        @update:model-value="$emit('update:opacity', $event)"
      />
    </template>
  </label-editor>
</template>
