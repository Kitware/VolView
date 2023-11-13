<script setup lang="ts">
import LabelEditor from '@/src/components/LabelEditor.vue';

defineEmits(['done', 'cancel', 'delete', 'update:name', 'update:color']);

defineProps({
  name: String,
  color: String,
});
</script>

<template>
  <label-editor
    :color="color"
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
      />
    </template>
  </label-editor>
</template>
