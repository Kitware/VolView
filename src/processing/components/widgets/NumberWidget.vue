<template>
  <v-text-field
    :model-value="text"
    :label="param.title || param.id"
    :hint="param.help"
    :min="numeric?.min"
    :max="numeric?.max"
    :step="numeric?.step ?? 'any'"
    :error-messages="error ?? []"
    type="number"
    density="compact"
    hide-details="auto"
    persistent-hint
    @update:model-value="onInput"
  />
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { VolViewTaskParameter } from '@/backend-contract';

const props = defineProps<{
  param: VolViewTaskParameter;
  modelValue: number | null | undefined;
}>();
const emit = defineEmits<{
  (e: 'update:modelValue', v: number | null): void;
}>();

// Only int/float carry min/max/step; narrow so the template can read them.
const numeric = computed(() =>
  props.param.kind === 'int' || props.param.kind === 'float'
    ? props.param
    : null
);

// The field owns its raw text: rejected input (e.g. "1.9" for an int) must
// stay visible under its error rather than being clobbered by the null the
// widget emits for it.
const text = ref(props.modelValue == null ? '' : String(props.modelValue));
const error = ref<string | null>(null);

watch(
  () => props.modelValue,
  (v) => {
    if (error.value != null) return; // keep rejected text visible mid-edit
    const current = text.value === '' ? null : Number(text.value);
    if (v !== current) text.value = v == null ? '' : String(v);
  }
);

// Reject instead of coercing: parseInt("1.9") would silently submit 1. A
// value that fails these checks emits null (blocking submit if required) and
// names the problem inline.
function problemWith(parsed: number): string | null {
  if (!Number.isFinite(parsed)) return 'Enter a number';
  if (props.param.kind !== 'int') return null;
  if (!Number.isInteger(parsed)) return 'Enter a whole number';
  const step = numeric.value?.step;
  if (step != null && (parsed - (numeric.value?.min ?? 0)) % step !== 0) {
    const from = numeric.value?.min != null ? ` from ${numeric.value.min}` : '';
    return `Enter a value in steps of ${step}${from}`;
  }
  return null;
}

function onInput(value: string) {
  text.value = value ?? '';
  if (text.value === '') {
    error.value = null;
    emit('update:modelValue', null);
    return;
  }
  const parsed = Number(text.value);
  error.value = problemWith(parsed);
  emit('update:modelValue', error.value == null ? parsed : null);
}
</script>
