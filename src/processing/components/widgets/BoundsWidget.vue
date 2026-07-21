<template>
  <div class="bounds-widget">
    <div class="text-caption font-weight-medium">
      {{ param.title || param.id }}
      <span v-if="param.required" class="text-error">*</span>
    </div>
    <div v-if="param.help" class="text-caption text-medium-emphasis mb-1">
      {{ param.help }}
    </div>
    <div class="text-caption">
      <span v-if="bounds" class="text-success">
        ✓ bound from the crop tool: [{{ formatted }}]
      </span>
      <span v-else class="text-medium-emphasis">
        Set the crop box to define this region
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { VolViewTaskParameter } from '@/backend-contract';

// Renders a `bounds` input. Its value is a world-space LPS 6-tuple bound from
// the crop tool by the engine host (JobsModule); this widget displays it.
const props = defineProps<{
  param: VolViewTaskParameter;
  modelValue: number[] | null | undefined;
}>();

const bounds = computed(() =>
  Array.isArray(props.modelValue) && props.modelValue.length === 6
    ? props.modelValue
    : null
);
const formatted = computed(() =>
  bounds.value ? bounds.value.map((n) => n.toFixed(1)).join(', ') : ''
);
</script>

<style scoped>
.bounds-widget {
  padding: 6px 0;
}
</style>
