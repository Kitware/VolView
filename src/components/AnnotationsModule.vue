<script lang="ts">
import { defineComponent } from 'vue';
import MeasurementsRulerList from './MeasurementsRulerList.vue';
import MeasurementsRectangleList from './MeasurementsRectangleList.vue';
import MeasurementsPolygonList from './MeasurementsPolygonList.vue';
import LabelmapList from './LabelmapList.vue';
import ToolControls from './ToolControls.vue';

export default defineComponent({
  components: {
    MeasurementsRulerList,
    MeasurementsRectangleList,
    MeasurementsPolygonList,
    LabelmapList,
    ToolControls,
  },
  setup() {},
});
</script>

<template>
  <div class="overflow-y-auto mx-2 fill-height">
    <tool-controls />
    <div class="header">Measurements</div>
    <div class="content">
      <measurements-ruler-list />
      <measurements-rectangle-list />
      <measurements-polygon-list />
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
.annot-subheader {
  margin: 8px 0;
}

.empty-state {
  display: none;
}

.content:empty + .empty-state {
  display: block;
}
</style>

<style scoped src="./styles/annotations.css"></style>
