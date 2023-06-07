<script setup lang="ts">
import { computed } from 'vue';
import { useToolStore } from '../store/tools';
import { Tools } from '../store/tools/types';
import RectangleControls from './RectangleControls.vue';
import RulerControls from './RulerControls.vue';

const toolStore = useToolStore();

const tools = new Map([
  [Tools.Rectangle, { component: RectangleControls, label: 'Rectangle' }],
  [Tools.Ruler, { component: RulerControls, label: 'Ruler' }],
]);

const tool = computed(() => tools.get(toolStore.currentTool));
</script>

<template>
  <div v-if="tool">
    <div class="annotation-header">{{ tool.label }}</div>
    <div class="content">
      <component :is="tool.component" />
    </div>
  </div>
</template>
