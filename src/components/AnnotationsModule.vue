<script setup lang="ts">
import { ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { AnnotationToolType, Tools } from '@/src/store/tools/types';
import { useToolStore } from '@/src/store/tools';
import MeasurementsToolList from './MeasurementsToolList.vue';
import SegmentGroupControls from './SegmentGroupControls.vue';
import ToolControls from './ToolControls.vue';
import MeasurementRulerDetails from './MeasurementRulerDetails.vue';

const Tabs = {
  Measurements: 'measurements',
  SegmentGroups: 'segmentGroups',
};

const MeasurementTools = [
  {
    type: AnnotationToolType.Ruler,
    icon: 'mdi-ruler',
    details: MeasurementRulerDetails,
  },
  {
    type: AnnotationToolType.Rectangle,
    icon: 'mdi-vector-square',
  },
  {
    type: AnnotationToolType.Polygon,
    icon: 'mdi-pentagon-outline',
  },
];

const MeasurementToolTypes = new Set<string>(
  MeasurementTools.map(({ type }) => type)
);

const tab = ref(Tabs.SegmentGroups);
const { currentTool } = storeToRefs(useToolStore());

function autoFocusTab() {
  if (currentTool.value === Tools.Paint) {
    tab.value = Tabs.SegmentGroups;
  } else if (MeasurementToolTypes.has(currentTool.value)) {
    tab.value = Tabs.Measurements;
  }
}

watch(
  currentTool,
  () => {
    autoFocusTab();
  },
  { immediate: true }
);
</script>

<template>
  <div>
    <tool-controls />
    <v-tabs v-model="tab" density="compact" grow class="annotation-tabs my-1">
      <v-tab value="segmentGroups" class="tab-header">Segment Groups</v-tab>
      <v-tab value="measurements" class="tab-header">Measurements</v-tab>
    </v-tabs>
    <v-window v-model="tab">
      <v-window-item value="segmentGroups">
        <segment-group-controls />
      </v-window-item>
      <v-window-item value="measurements">
        <measurements-tool-list :tools="MeasurementTools" />
      </v-window-item>
    </v-window>
  </div>
</template>

<style scoped>
.annotation-tabs :deep(.v-tab.v-tab) {
  flex: 1 1 0;
  min-width: 0;
}

.tab-header {
  font-size: 0.8rem;
}
</style>

<style scoped src="./styles/annotations.css"></style>
