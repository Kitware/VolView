<script setup lang="ts">
import { ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { AnnotationToolType, Tools } from '@/src/store/tools/types';
import { useToolStore } from '@/src/store/tools';
import MeasurementsToolList from './MeasurementsToolList.vue';
import LabelmapControls from './LabelmapControls.vue';
import ToolControls from './ToolControls.vue';
import MeasurementRulerDetails from './MeasurementRulerDetails.vue';

const Tabs = {
  Measurements: 'measurements',
  Labelmaps: 'labelmaps',
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

const tab = ref('measurements');
const { currentTool } = storeToRefs(useToolStore());

function autoFocusTab() {
  if (currentTool.value === Tools.Paint) {
    tab.value = Tabs.Labelmaps;
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
  <div class="overflow-y-auto mx-2 fill-height">
    <tool-controls />
    <v-divider thickness="4" />
    <v-tabs v-model="tab" align-tabs="center" density="compact" class="my-1">
      <v-tab value="measurements" class="tab-header">Measurements</v-tab>
      <v-tab value="labelmaps" class="tab-header">Labelmaps</v-tab>
    </v-tabs>
    <v-window v-model="tab">
      <v-window-item value="measurements">
        <measurements-tool-list :tools="MeasurementTools" />
      </v-window-item>
      <v-window-item value="labelmaps">
        <labelmap-controls />
      </v-window-item>
    </v-window>
  </div>
</template>

<style scoped>
.tab-header {
  font-size: 0.8rem;
}
</style>

<style scoped src="./styles/annotations.css"></style>
