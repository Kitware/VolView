<template>
  <v-select
    :model-value="modelValue"
    :items="tasks"
    :disabled="disabled"
    item-title="title"
    item-value="id"
    label="Task"
    variant="outlined"
    density="compact"
    hide-details
    @update:model-value="(v) => emit('update:modelValue', v as string | null)"
  />
</template>

<script setup lang="ts">
import type { TaskSummary } from '@/src/processing/types';

defineProps<{
  tasks: TaskSummary[];
  modelValue?: string | null;
  disabled?: boolean;
}>();
const emit = defineEmits<{
  (e: 'update:modelValue', id: string | null): void;
}>();
</script>
