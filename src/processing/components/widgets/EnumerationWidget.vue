<template>
  <v-select
    :model-value="modelValue ?? null"
    :items="items"
    :label="param.title || param.id"
    :hint="param.help"
    density="compact"
    hide-details="auto"
    persistent-hint
    @update:model-value="onUpdate"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { VolViewTaskParameter } from '@/backend-contract';

const props = defineProps<{
  param: VolViewTaskParameter;
  modelValue: string | number | null | undefined;
}>();
const emit = defineEmits<{
  (e: 'update:modelValue', v: string | number | null): void;
}>();

// The enum options live only on the `enum` kind. Options may be numeric
// (Slicer integer/float enumerations); the selected value keeps its type.
const items = computed(() =>
  props.param.kind === 'enum' ? props.param.options : []
);
const onUpdate = (v: unknown) =>
  emit('update:modelValue', (v ?? null) as string | number | null);
</script>
