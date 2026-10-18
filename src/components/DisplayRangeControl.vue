<script setup lang="ts">
import { computed, ref, watch, useId } from 'vue';
import { formatDisplayRange } from '@/src/utils/formatDisplayRange';
import ColorMapRangeControl from './ColorMapRangeControl.vue';

const props = withDefaults(
  defineProps<{
    modelValue: readonly [number, number];
    dataRange: readonly [number, number];
    preset: string;
    transparentBackground?: boolean;
    disabled?: boolean;
    testIdPrefix?: string;
  }>(),
  { testIdPrefix: 'layer-range' }
);
const emit = defineEmits<{
  'update:modelValue': [range: [number, number]];
}>();
const rangeMessageId = useId();

const minimum = ref('');
const maximum = ref('');
type RangeEndpoint = 'min' | 'max';
const dirty = ref({ min: false, max: false });
const formattedRange = computed(() => formatDisplayRange(props.modelValue));
function refreshRangeInputs() {
  if (!dirty.value.min) minimum.value = formattedRange.value[0];
  if (!dirty.value.max) maximum.value = formattedRange.value[1];
}
watch(
  [() => props.modelValue[0], () => props.modelValue[1]],
  refreshRangeInputs,
  { immediate: true }
);
function blurRangeInput(endpoint: RangeEndpoint) {
  if (!props.disabled && !rangeError.value) dirty.value[endpoint] = false;
  refreshRangeInputs();
}
const draftRange = computed(() => [
  dirty.value.min ? Number(minimum.value) : props.modelValue[0],
  dirty.value.max ? Number(maximum.value) : props.modelValue[1],
]);
const rangeError = computed(() => {
  if (props.disabled) return '';
  if (!minimum.value.trim() || !maximum.value.trim())
    return 'Enter both Min and Max.';
  const [min, max] = draftRange.value;
  if (
    min === undefined ||
    max === undefined ||
    !Number.isFinite(min) ||
    !Number.isFinite(max)
  )
    return 'Min and Max must be finite numbers.';
  if (min >= max) return 'Min must be less than Max.';
  if (!Number.isFinite(max - min)) return 'The display range is too large.';
  return '';
});
function setRange(range: number[]) {
  const [min, max] = range;
  if (
    props.disabled ||
    !Number.isFinite(min) ||
    !Number.isFinite(max) ||
    min >= max ||
    !Number.isFinite(max - min)
  )
    return;
  emit('update:modelValue', [min, max]);
}
function updateRangeInput(endpoint: RangeEndpoint, value: string) {
  dirty.value[endpoint] = true;
  if (endpoint === 'min') minimum.value = value;
  else maximum.value = value;
  const [min, max] = draftRange.value;
  if (!rangeError.value && min !== undefined && max !== undefined)
    setRange([min, max]);
}
const inputStep = computed(() => {
  const imageSpan = props.dataRange[1] - props.dataRange[0];
  const span =
    Number.isFinite(imageSpan) && imageSpan > 0
      ? imageSpan
      : props.modelValue[1] - props.modelValue[0];
  if (!Number.isFinite(span) || span <= 0) return 0;
  return Math.max(
    Number.MIN_VALUE,
    Math.min(1, 10 ** (Math.floor(Math.log10(span)) - 2))
  );
});
function steppedRange(endpoint: RangeEndpoint, direction: number) {
  if (props.disabled || rangeError.value) return undefined;
  const index = endpoint === 'min' ? 0 : 1;
  const current = draftRange.value[index];
  const next = current + direction * inputStep.value;
  const range: [number, number] = [...props.modelValue];
  range[index] = next;
  if (
    next === current ||
    !Number.isFinite(next) ||
    range[0] >= range[1] ||
    !Number.isFinite(range[1] - range[0])
  )
    return undefined;
  return range;
}
function stepRange(endpoint: RangeEndpoint, direction: number) {
  const range = steppedRange(endpoint, direction);
  if (!range) return;
  dirty.value[endpoint] = false;
  setRange(range);
  refreshRangeInputs();
}
function resetDrafts() {
  dirty.value = { min: false, max: false };
  refreshRangeInputs();
}
defineExpose({ resetDrafts });
function updateRangeControl(range: number[]) {
  dirty.value = { min: false, max: false };
  setRange(range);
  refreshRangeInputs();
}
</script>

<template>
  <div>
    <ColorMapRangeControl
      :model-value="modelValue"
      :data-range="dataRange"
      :preset="preset"
      :test-id-prefix="testIdPrefix"
      :transparent-background="transparentBackground"
      :disabled="disabled"
      :describedby="rangeError ? rangeMessageId : undefined"
      @update:model-value="updateRangeControl"
    />
    <div
      class="d-flex align-end justify-space-between flex-nowrap"
      :class="$slots.actions ? 'ga-2' : 'ga-4'"
    >
      <v-text-field
        :model-value="minimum"
        label="Min"
        aria-label="Display range minimum"
        :aria-describedby="rangeError ? rangeMessageId : undefined"
        inputmode="decimal"
        :disabled="disabled"
        :error="!!rangeError"
        class="range-input"
        density="compact"
        variant="underlined"
        hide-details
        :data-testid="`${testIdPrefix}-min`"
        :title="String(modelValue[0])"
        @blur="blurRangeInput('min')"
        @update:model-value="updateRangeInput('min', $event)"
        @keydown.up.prevent="stepRange('min', 1)"
        @keydown.down.prevent="stepRange('min', -1)"
      >
        <template #append-inner>
          <div class="range-stepper">
            <button
              v-for="direction in [1, -1]"
              :key="direction"
              type="button"
              :aria-label="`${direction === 1 ? 'Increase' : 'Decrease'} display range minimum`"
              :data-testid="`${testIdPrefix}-min-${direction === 1 ? 'increase' : 'decrease'}`"
              :disabled="!steppedRange('min', direction)"
              @mousedown.prevent
              @click="stepRange('min', direction)"
            >
              <v-icon
                :icon="direction === 1 ? 'mdi-menu-up' : 'mdi-menu-down'"
                size="14"
              />
            </button>
          </div>
        </template>
      </v-text-field>
      <div v-if="$slots.actions" class="range-actions">
        <slot name="actions" />
      </div>
      <v-text-field
        :model-value="maximum"
        label="Max"
        aria-label="Display range maximum"
        :aria-describedby="rangeError ? rangeMessageId : undefined"
        inputmode="decimal"
        :disabled="disabled"
        :error="!!rangeError"
        class="range-input"
        density="compact"
        variant="underlined"
        hide-details
        :data-testid="`${testIdPrefix}-max`"
        :title="String(modelValue[1])"
        @blur="blurRangeInput('max')"
        @update:model-value="updateRangeInput('max', $event)"
        @keydown.up.prevent="stepRange('max', 1)"
        @keydown.down.prevent="stepRange('max', -1)"
      >
        <template #append-inner>
          <div class="range-stepper">
            <button
              v-for="direction in [1, -1]"
              :key="direction"
              type="button"
              :aria-label="`${direction === 1 ? 'Increase' : 'Decrease'} display range maximum`"
              :data-testid="`${testIdPrefix}-max-${direction === 1 ? 'increase' : 'decrease'}`"
              :disabled="!steppedRange('max', direction)"
              @mousedown.prevent
              @click="stepRange('max', direction)"
            >
              <v-icon
                :icon="direction === 1 ? 'mdi-menu-up' : 'mdi-menu-down'"
                size="14"
              />
            </button>
          </div>
        </template>
      </v-text-field>
    </div>
    <div
      v-if="rangeError"
      :id="rangeMessageId"
      class="text-caption text-error mt-1"
      role="status"
      :data-testid="`${testIdPrefix}-status`"
    >
      {{ rangeError }}
    </div>
  </div>
</template>

<style scoped>
.range-actions {
  flex: 0 0 auto;
}

.range-input {
  flex: 0 1 104px;
  min-width: 0;
}

.range-stepper {
  display: flex;
  flex-direction: column;
  width: 14px;
  height: 24px;
  opacity: 0;
}
.range-input:hover .range-stepper,
.range-input:focus-within .range-stepper {
  opacity: 1;
}
.range-stepper button {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 12px;
  color: rgb(var(--v-theme-on-surface));
}
.range-stepper button:hover:not(:disabled),
.range-stepper button:focus-visible {
  background: rgba(var(--v-theme-on-surface), var(--v-hover-opacity));
}
.range-stepper button:disabled {
  opacity: var(--v-disabled-opacity);
}
.range-input :deep(.v-field__append-inner) {
  padding-inline-start: 0;
}
</style>
