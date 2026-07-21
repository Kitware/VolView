<template>
  <div v-if="slider" class="d-flex align-center">
    <v-slider
      :model-value="modelValue ?? slider.min"
      :min="slider.min"
      :max="slider.max"
      :step="slider.step ?? 0"
      :hint="param.help"
      density="compact"
      hide-details="auto"
      persistent-hint
      color="grey-lighten-1"
      @update:model-value="(v: number) => emit('update:modelValue', v)"
    />
    <span class="slider-value text-caption ml-2">
      {{ modelValue ?? slider.min }}
    </span>
  </div>
  <v-text-field
    v-else
    :model-value="text"
    :hint="param.help"
    :min="numeric?.min"
    :max="numeric?.max"
    :step="numeric?.step ?? 'any'"
    :error-messages="error ?? []"
    type="number"
    variant="outlined"
    density="compact"
    hide-details="auto"
    persistent-hint
    @update:model-value="onInput"
  />
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { VolViewTaskParameter } from '@/backend-contract';
import { sliderConfig } from '@/src/processing/engine/formModel';

const props = defineProps<{
  param: VolViewTaskParameter;
  modelValue: number | null | undefined;
}>();
const emit = defineEmits<{
  (e: 'update:modelValue', v: number | null): void;
  (e: 'update:error', v: string | null): void;
}>();

const numeric = computed(() =>
  props.param.kind === 'int' || props.param.kind === 'float'
    ? props.param
    : null
);

const slider = computed(() => sliderConfig(props.param));

// Raw text is local so rejected input stays visible instead of being clobbered by the emitted null.
const text = ref(props.modelValue == null ? '' : String(props.modelValue));
const error = ref<string | null>(null);

watch(
  () => props.modelValue,
  (v) => {
    if (error.value != null) return;
    const current = text.value === '' ? null : Number(text.value);
    if (v !== current) text.value = v == null ? '' : String(v);
  }
);

// Reject instead of coercing, since coercing "1.9" for an int silently submits 1.
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
    emit('update:error', null);
    emit('update:modelValue', null);
    return;
  }
  const parsed = Number(text.value);
  error.value = problemWith(parsed);
  // The form must know about the rejection too, or an optional field with
  // rejected text would leave Submit enabled while displaying an error.
  emit('update:error', error.value);
  emit('update:modelValue', error.value == null ? parsed : null);
}
</script>

<style scoped>
.slider-value {
  min-width: 2.5em;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
</style>
