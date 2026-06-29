<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import PaintControls from '@/src/components/PaintControls.vue';
import { useToolStore } from '../store/tools';
import { Tools } from '../store/tools/types';
import RectangleControls from './RectangleControls.vue';
import RulerControls from './RulerControls.vue';
import PolygonControls from './PolygonControls.vue';

const toolStore = useToolStore();
const TOOL_PANEL = 'tool';
const activePanels = ref([TOOL_PANEL]);

const tools = new Map([
  [
    Tools.Rectangle,
    {
      component: RectangleControls,
      label: 'Rectangle',
      icon: 'mdi-vector-square',
      wrapInPanel: true,
    },
  ],
  [
    Tools.Ruler,
    {
      component: RulerControls,
      label: 'Ruler',
      icon: 'mdi-ruler',
      wrapInPanel: true,
    },
  ],
  [
    Tools.Polygon,
    {
      component: PolygonControls,
      label: 'Polygon',
      icon: 'mdi-vector-polygon',
      wrapInPanel: true,
    },
  ],
  [
    Tools.Paint,
    {
      component: PaintControls,
      label: 'Paint',
      icon: 'mdi-brush',
      wrapInPanel: false,
    },
  ],
]);

const tool = computed(() => tools.get(toolStore.currentTool));

watch(
  () => toolStore.currentTool,
  () => {
    activePanels.value = [TOOL_PANEL];
  }
);
</script>

<template>
  <div v-if="tool">
    <v-expansion-panels
      v-if="tool.wrapInPanel"
      v-model="activePanels"
      multiple
      variant="accordion"
      class="tool-control-panels"
    >
      <v-expansion-panel :value="TOOL_PANEL">
        <v-expansion-panel-title>
          <v-icon class="flex-grow-0 mr-4">{{ tool.icon }}</v-icon>
          {{ tool.label }}
        </v-expansion-panel-title>
        <v-expansion-panel-text class="control-panel-body">
          <component :is="tool.component" />
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>
    <component v-else :is="tool.component" />
  </div>
</template>

<style scoped>
.tool-control-panels {
  width: 100%;
}

.control-panel-body :deep(.v-expansion-panel-text__wrapper) {
  padding: 12px 14px 16px;
}
</style>
