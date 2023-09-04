<script setup lang="ts" generic="ToolID extends string">
/* global ToolID:readonly */
import { AnnotationToolStore } from '@/src/store/tools/useAnnotationTool';
import { OverlayInfo } from '@/src/composables/annotationTool';
import { computed } from 'vue';

const props = defineProps<{
  info: OverlayInfo<ToolID>;
  toolStore: AnnotationToolStore<ToolID>;
}>();

const menu = computed(() => {
  return props.info.visible;
});

const label = computed(() => {
  if (!props.info.visible) return '';
  return props.toolStore.toolByID[props.info.toolID].labelName;
});
</script>

<template>
  <v-menu
    v-model="menu"
    v-if="info.visible"
    class="popover-no-events"
    :style="{
      left: `${info.displayXY[0]}px`,
      top: `${info.displayXY[1]}px`,
      pointerEvents: 'none',
    }"
  >
    <v-list density="compact">
      <v-list-item>
        <v-list-item-title>{{ label }}</v-list-item-title>
      </v-list-item>
    </v-list>
  </v-menu>
</template>

<style>
.popover-no-events > * {
  pointer-events: none !important;
  touch-action: none;
}
</style>
