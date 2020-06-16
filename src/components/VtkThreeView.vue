<template>
  <div class="vtk-container-wrapper">
    <div class="vtk-gutter"></div>
    <div
      class="vtk-container"
      :class="active ? 'active' : ''"
      v-resize="onResize"
    >
      <div class="vtk-sub-container">
        <div class="vtk-view" ref="vtkContainer" />
      </div>
    </div>
  </div>
</template>

<script>
import VtkViewMixin from '@/src/mixins/VtkView';

export default {
  name: 'VtkThreeView',

  mixins: [VtkViewMixin],

  methods: {
    afterViewMount() {
      this.view.setBackground(0.1, 0.2, 0.3);
    },
  },
};
</script>

<style>
.vtk-view > canvas {
  height: 100%;
}
</style>

<style scoped src="@/src/assets/styles/vtk-view.css"></style>
