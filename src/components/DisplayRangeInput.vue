<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  endpoint: 'min' | 'max';
  modelValue: string;
  appliedValue: number;
  canIncrease: boolean;
  canDecrease: boolean;
  disabled?: boolean;
  error?: boolean;
  describedby?: string;
  testIdPrefix: string;
}>();

defineEmits<{
  'update:modelValue': [value: string];
  focus: [];
  blur: [];
  step: [direction: number];
}>();

const endpointName = computed(() =>
  props.endpoint === 'min' ? 'minimum' : 'maximum'
);
</script>

<template>
  <v-text-field
    :model-value="modelValue"
    :label="endpoint === 'min' ? 'Min' : 'Max'"
    :aria-label="`Display range ${endpointName}`"
    :aria-describedby="describedby"
    inputmode="decimal"
    :disabled="disabled"
    :error="error"
    class="range-input"
    density="compact"
    variant="underlined"
    hide-details
    :data-testid="`${testIdPrefix}-${endpoint}`"
    :title="String(appliedValue)"
    @focus="$emit('focus')"
    @blur="$emit('blur')"
    @update:model-value="$emit('update:modelValue', $event)"
    @keydown.up.prevent="$emit('step', 1)"
    @keydown.down.prevent="$emit('step', -1)"
  >
    <template #append-inner>
      <div class="range-stepper">
        <button
          v-for="direction in [1, -1]"
          :key="direction"
          type="button"
          :aria-label="`${direction === 1 ? 'Increase' : 'Decrease'} display range ${endpointName}`"
          :data-testid="`${testIdPrefix}-${endpoint}-${direction === 1 ? 'increase' : 'decrease'}`"
          :disabled="direction === 1 ? !canIncrease : !canDecrease"
          :title="
            disabled || (direction === 1 ? canIncrease : canDecrease)
              ? undefined
              : 'This step must keep a finite range with Min below Max.'
          "
          @mousedown.prevent
          @click="$emit('step', direction)"
        >
          <v-icon
            :icon="direction === 1 ? 'mdi-menu-up' : 'mdi-menu-down'"
            size="14"
          />
        </button>
      </div>
    </template>
  </v-text-field>
</template>

<style scoped>
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
