<script setup lang="ts">
import { computed } from 'vue';
import PaintControls from '@/src/components/PaintControls.vue';
import { useToolStore } from '../store/tools';
import { Tools } from '../store/tools/types';
import RectangleControls from './RectangleControls.vue';
import RulerControls from './RulerControls.vue';
import PolygonControls from './PolygonControls.vue';

const toolStore = useToolStore();

const tools = new Map([
  [Tools.Rectangle, { component: RectangleControls, label: 'Rectangle' }],
  [Tools.Ruler, { component: RulerControls, label: 'Ruler' }],
  [Tools.Polygon, { component: PolygonControls, label: 'Polygon' }],
  [Tools.Paint, { component: PaintControls, label: 'Paint' }],
]);

const tool = computed(() => tools.get(toolStore.currentTool));
</script>

<template>
  <div v-if="tool">
    <div class="header">{{ tool.label }}</div>
    <div class="content">
      <component :is="tool.component" />
    </div>
  </div>
</template>

<style scoped src="./styles/annotations.css"></style>
