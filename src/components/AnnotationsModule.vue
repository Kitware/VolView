<script lang="ts">
import { defineComponent } from 'vue';
import MeasurementsRulerList from './MeasurementsRulerList.vue';
import MeasurementsRectangleList from './MeasurementsRectangleList.vue';
import LabelmapList from './LabelmapList.vue';
import ToolControls from './ToolControls.vue';

export default defineComponent({
  components: {
    MeasurementsRulerList,
    MeasurementsRectangleList,
    LabelmapList,
    ToolControls,
  },
  setup() {},
});
</script>

<template>
  <div class="overflow-y-auto mx-2 fill-height">
    <tool-controls />
    <div class="annotation-header">Measurements</div>
    <div class="content">
      <measurements-ruler-list />
      <measurements-rectangle-list />
    </div>
    <div class="text-caption text-center empty-state">No measurements</div>
    <div class="header">Labelmaps</div>
    <div class="content">
      <labelmap-list />
    </div>
    <div class="text-caption text-center empty-state">No labelmaps</div>
  </div>
</template>

<style>
.annot-subheader {
  margin: 8px 0;
}
.annotation-header {
  background: rgba(var(--v-theme-surface-variant), 0.08);
  padding: 4px;
  margin: 8px 0;
  width: 100%;
  text-align: center;
  font-size: 0.875rem;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}

.empty-state {
  display: none;
}

.content:empty + .empty-state {
  display: block;
}
</style>
