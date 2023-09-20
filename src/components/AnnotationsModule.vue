<script setup lang="ts">
import { AnnotationToolType } from '@/src/store/tools/types';
import MeasurementsToolList from './MeasurementsToolList.vue';
import LabelmapList from './LabelmapList.vue';
import ToolControls from './ToolControls.vue';
import MeasurementRulerDetails from './MeasurementRulerDetails.vue';

const tools = [
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
