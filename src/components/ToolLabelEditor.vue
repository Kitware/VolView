<script setup lang="ts">
import LabelEditor from '@/src/components/LabelEditor.vue';

defineEmits([
  'done',
  'cancel',
  'delete',
  'update:name',
  'update:strokeWidth',
  'update:color',
]);

defineProps({
  name: String,
  strokeWidth: Number,
  color: String,
});
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
      />
      <v-text-field
        label="Stroke Width"
        type="number"
        class="flex-grow-0"
        :model-value="strokeWidth"
        @update:model-value="$emit('update:strokeWidth', +$event)"
        @keydown.stop.enter="done"
      />
    </template>
  </label-editor>
</template>
