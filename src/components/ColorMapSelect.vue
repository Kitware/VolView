<script setup lang="ts">
import { LAYER_PRESET_OPTIONS } from '@/src/vtk/LayerColorPresets';
import ColorMapSwatch from './ColorMapSwatch.vue';

withDefaults(
  defineProps<{
    modelValue: string;
    disabled?: boolean;
    testIdPrefix?: string;
  }>(),
  { testIdPrefix: 'layer' }
);
defineEmits<{ 'update:modelValue': [value: string] }>();
</script>

<template>
  <v-select
    label="Color map"
    :items="LAYER_PRESET_OPTIONS"
    :menu-props="{ width: 0 }"
    :model-value="modelValue"
    :disabled="disabled"
    density="compact"
    variant="plain"
    hide-details
    :data-testid="`${testIdPrefix}-colormap`"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <template #item="{ item, props: itemProps }">
      <v-list-item v-bind="itemProps">
        <template #prepend>
          <ColorMapSwatch
            :preset="item.value"
            class="palette-swatch mr-3"
            aria-hidden="true"
            :data-testid="`${testIdPrefix}-palette-option-swatch`"
          />
        </template>
      </v-list-item>
    </template>
    <template #selection="{ item }">
      <div class="palette-selection d-flex align-center ga-2">
        <ColorMapSwatch
          :preset="item.value"
          class="palette-swatch"
          aria-hidden="true"
        />
        <span class="text-ellipsis" :title="item.title">{{ item.title }}</span>
      </div>
    </template>
  </v-select>
</template>

<style scoped>
.palette-swatch {
  width: 88px;
  flex: 0 0 88px;
}
.palette-selection {
  min-width: 0;
  max-width: 100%;
}
</style>
