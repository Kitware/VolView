<script setup lang="ts">
import MeasurementsToolList from './MeasurementsToolList.vue';
import LabelmapList from './LabelmapList.vue';
import ToolControls from './ToolControls.vue';
import { usePolygonStore } from '../store/tools/polygons';
import { useRectangleStore } from '../store/tools/rectangles';
import { useRulerStore } from '../store/tools/rulers';
import { AnnotationToolStore } from '../store/tools/useAnnotationTool';
import MeasurementRulerDetails from './MeasurementRulerDetails.vue';

const tools = [
  {
    store: useRulerStore(),
    icon: 'mdi-ruler',
    details: MeasurementRulerDetails,
  },
  {
    store: useRectangleStore() as unknown as AnnotationToolStore<string>,
    icon: 'mdi-vector-square',
  },
  {
    store: usePolygonStore() as unknown as AnnotationToolStore<string>,
    icon: 'mdi-pentagon-outline',
  },
];
</script>

<template>
  <div class="overflow-y-auto mx-2 fill-height">
    <tool-controls />
    <div class="header">Measurements</div>
    <div class="content">
      <measurements-tool-list :tools="tools" />
    </div>
    <div class="text-caption text-center empty-state">No measurements</div>
    <div class="header">Labelmaps</div>
    <div class="content">
      <labelmap-list />
    </div>
    <div class="text-caption text-center empty-state">No labelmaps</div>
  </div>
</template>

<style scoped>
.empty-state {
  display: none;
}

.content:empty + .empty-state {
  display: block;
}
</style>

<style scoped src="./styles/annotations.css"></style>
