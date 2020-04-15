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
import VtkVueMixin from '@/src/mixins/VtkView';

export default {
  name: 'VtkTwoView',

  mixins: [VtkVueMixin],
};
</script>

<style>
.vtk-view > canvas {
  height: 100%;
}
</style>

<style scoped>
.vtk-container-wrapper {
  flex: 1;
  display: grid;
  grid-template-columns: 20px auto;
  grid-template-rows: auto;
  border: 1px solid #222;
}

.vtk-container {
  padding: 0 !important;
  margin: 0 !important;
  /* prevent view from overflowing our app during resize */
  min-height: 0;
  min-width: 0;
  width: 100%;

  position: relative;
  overflow: hidden;
  z-index: 0;
}

.vtk-sub-container {
  position: absolute;
  width: 100%;
  height: 100%;
}

.vtk-view {
  width: 100%;
  height: 100%;
}
</style>
