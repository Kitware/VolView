<script setup lang="ts">
import { computed, ref } from 'vue';
import { useElementSize } from '@vueuse/core';
import { AnnotationToolStore } from '@/src/store/tools/useAnnotationTool';
import { OverlayInfo } from '@/src/composables/annotationTool';

// These seem to work ¯\_(ツ)_/¯
const TOOLTIP_PADDING_X = 30;
const TOOLTIP_PADDING_Y = 10;

const props = defineProps<{
  info: OverlayInfo;
  toolStore: AnnotationToolStore;
}>();

const visible = computed(() => {
  return props.info.visible;
});

const metadata = computed(() => {
  if (!props.info.visible) return [] as Array<{ key: string; value: string }>;
  const meta = props.toolStore.toolByID[props.info.toolID].metadata ?? {};
  // Preserve insertion order of keys
  return Object.entries(meta).map(([key, value]) => {
    return {
      key,
      value,
    };
  });
});

const label = computed(() => {
  if (!props.info.visible) return '';
  return props.toolStore.toolByID[props.info.toolID].labelName;
});

const tooltip = ref();
const content = computed(() => {
  return tooltip.value?.contentEl;
});

const { width, height } = useElementSize(content);
const offset = computed(() => {
  return {
    // Tooltip location is above cursor and centered
    // Don't know how to get ref to parent v-tooltip element, so adding fudge padding.
    x: (width.value + TOOLTIP_PADDING_X) / 2,
    y: height.value + TOOLTIP_PADDING_Y,
  };
});
</script>

<template>
  <v-tooltip
    ref="tooltip"
    v-if="info.visible"
    v-model="visible"
    :style="{
      left: `${info.displayXY[0] - offset.x}px`,
      top: `${info.displayXY[1] - offset.y}px`,
      zIndex: 500, // stay under context menu
    }"
    class="better-contrast"
  >
    <div class="tooltip-text font-weight-bold">{{ label }}</div>
    <div v-if="metadata.length > 0">
      <v-divider></v-divider>
      <div v-for="item in metadata" :key="item.key" class="tooltip-text">
        {{ item.key }}: {{ item.value }}
      </div>
    </div>
  </v-tooltip>
</template>

<style scoped>
.better-contrast :deep(.v-overlay__content) {
  opacity: 1 !important;
  background: rgba(255, 255, 255, 0.9) !important;
  padding-left: 0;
  padding-right: 0;
}

.tooltip-text {
  padding: 0 10px;
}
</style>
