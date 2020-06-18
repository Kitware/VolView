<template>
  <div class="vtk-container-wrapper">
    <div class="vtk-gutter"></div>
    <div
      class="vtk-container"
      :class="active ? 'active' : ''"
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
      this.view.setCornerAnnotation('nw', 'ColorMap');
      this.view.setOrientationAxesType('cube');
    },
  },
};
</script>

<style src="@/src/assets/styles/vtk-view.css"></style>
