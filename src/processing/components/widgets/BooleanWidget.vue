<template>
  <!-- Neutral when on: the accent blue is reserved for tabs and links. -->
  <v-switch
    :model-value="modelValue === true"
    :label="label"
    :hint="param.help"
    persistent-hint
    density="compact"
    hide-details="auto"
    color="grey-lighten-1"
    @update:model-value="(v) => emit('update:modelValue', !!v)"
  />
</template>

<script setup lang="ts">
import type { VolViewTaskParameter } from '@/backend-contract';

defineProps<{
  param: VolViewTaskParameter;
  modelValue: boolean | null | undefined;
  label?: string;
}>();
const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void;
}>();
</script>
