<script lang="ts">
import { defineComponent } from 'vue';
import MeasurementsRulerList from './MeasurementsRulerList.vue';
import MeasurementsToolList from './MeasurementsToolList.vue';
import LabelmapList from './LabelmapList.vue';
import ToolControls from './ToolControls.vue';
import { usePolygonStore } from '../store/tools/polygons';
import { useRectangleStore } from '../store/tools/rectangles';

export default defineComponent({
  components: {
    MeasurementsRulerList,
    MeasurementsToolList,
    LabelmapList,
    ToolControls,
  },
  setup() {
    return {
      rectangleStore: useRectangleStore(),
      polygonStore: usePolygonStore(),
    };
  },
});
</script>

<template>
  <div class="overflow-y-auto mx-2 fill-height">
    <tool-controls />
    <div class="header">Measurements</div>
    <div class="content">
      <measurements-ruler-list />
      <measurements-tool-list
        :tool-store="rectangleStore"
        icon="mdi-vector-square"
      />
      <measurements-tool-list
        :tool-store="polygonStore"
        icon="mdi-pentagon-outline"
      />
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
