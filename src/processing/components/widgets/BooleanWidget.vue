<template>
  <v-checkbox
    :model-value="modelValue === true"
    :label="param.title || param.id"
    :hint="param.help"
    persistent-hint
    density="compact"
    hide-details="auto"
    @update:model-value="(v) => emit('update:modelValue', !!v)"
  />
</template>

<script setup lang="ts">
import type { VolViewTaskParameter } from '@/backend-contract';

defineProps<{
  param: VolViewTaskParameter;
  modelValue: boolean | null | undefined;
}>();
const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void;
}>();
</script>
