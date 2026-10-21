<script setup lang="ts">
import { computed, nextTick, ref, watchEffect, useId } from 'vue';
import { adjacentNumber } from '@/src/utils/adjacentNumber';
import { formatDisplayRange } from '@/src/utils/formatDisplayRange';
import { isValidDisplayRange } from '@/src/utils/isValidDisplayRange';
import ColorMapRangeControl from './ColorMapRangeControl.vue';
import DisplayRangeInput from './DisplayRangeInput.vue';

const props = withDefaults(
  defineProps<{
    modelValue: readonly [number, number];
    dataRange: readonly [number, number];
    preset: string;
    transparentBackground?: boolean;
    disabled?: boolean;
    windowLevel?: boolean;
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
const endpoints = ['min', 'max'] as const;
type RangeEndpoint = (typeof endpoints)[number];
const dirty = ref({ min: false, max: false });
const focused = ref<RangeEndpoint>();
const formattedRange = computed(() => formatDisplayRange(props.modelValue));

function refreshRangeInputs() {
  if (!dirty.value.min) minimum.value = formattedRange.value[0];
  if (!dirty.value.max) maximum.value = formattedRange.value[1];
}

watchEffect(refreshRangeInputs);

function blurRangeInput(endpoint: RangeEndpoint) {
  focused.value = undefined;
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
  if (!Number.isFinite(min) || !Number.isFinite(max))
    return 'Min and Max must be finite numbers.';
  if (min >= max) return 'Min must be less than Max.';
  if (!Number.isFinite(max - min)) return 'The display range is too large.';
  return '';
});

function setRange(range: [number, number]) {
  const [min, max] = range;
  if (props.disabled || !isValidDisplayRange(range)) return;
  emit('update:modelValue', [min, max]);
}

async function updateRangeInput(endpoint: RangeEndpoint, value: string) {
  dirty.value[endpoint] = true;
  if (endpoint === 'min') minimum.value = value;
  else maximum.value = value;
  const [min, max] = draftRange.value;
  if (rangeError.value || min === undefined || max === undefined) return;
  setRange([min, max]);
  const halfWidth = (max - min) / 2;
  const level = min + halfWidth;
  const expected = props.windowLevel
    ? [level - halfWidth, level + halfWidth]
    : [min, max];
  await nextTick();
  if (
    expected.some(
      (endpointValue, index) => endpointValue !== props.modelValue[index]
    )
  )
    return;
  const sibling = endpoint === 'min' ? 'max' : 'min';
  if (focused.value !== sibling) dirty.value[sibling] = false;
  refreshRangeInputs();
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
  // Width/level reconstruction needs room for rounding at both endpoints.
  const resolution =
    2 * Number.EPSILON * Math.max(...props.modelValue.map(Math.abs));
  const step = Math.max(inputStep.value, resolution);
  const stepped = current + direction * step;
  const next =
    stepped === current ? adjacentNumber(current, direction) : stepped;
  const range: [number, number] = [...props.modelValue];
  range[index] = next;
  if (next === current || !isValidDisplayRange(range)) return undefined;
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

function updateRangeControl(range: [number, number]) {
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
      :window-level="windowLevel"
      :describedby="rangeError ? rangeMessageId : undefined"
      @update:model-value="updateRangeControl"
    />
    <div
      class="d-flex align-end justify-space-between flex-nowrap"
      :class="$slots.actions ? 'ga-2' : 'ga-4'"
    >
      <template v-for="(endpoint, index) in endpoints" :key="endpoint">
        <div v-if="index === 1 && $slots.actions" class="range-actions">
          <slot name="actions" />
        </div>
        <DisplayRangeInput
          :endpoint="endpoint"
          :model-value="endpoint === 'min' ? minimum : maximum"
          :applied-value="modelValue[index]"
          :can-increase="!!steppedRange(endpoint, 1)"
          :can-decrease="!!steppedRange(endpoint, -1)"
          :disabled="disabled"
          :error="!!rangeError"
          :describedby="rangeError ? rangeMessageId : undefined"
          :test-id-prefix="testIdPrefix"
          @focus="focused = endpoint"
          @blur="blurRangeInput(endpoint)"
          @update:model-value="updateRangeInput(endpoint, $event)"
          @step="stepRange(endpoint, $event)"
        />
      </template>
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
</style>
