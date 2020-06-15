<template>
  <div class="container-wrapper">
    <v-container
      fluid
      fill-height
      class="container"
      :class="active ? 'active' : ''"
      v-resize="onResize"
    >
      <div class="sub-container">
        <div class="vtk-view" ref="vtkContainer" />
      </div>
    </v-container>
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

<style scoped>
.container-wrapper {
  width: 100%;
  height: 100%;
}

.container {
  padding: 0 !important;
  margin: 0 !important;
  /* prevent view from overflowing our app during resize */
  min-height: 0;
  min-width: 0;
  max-width: 100%;

  position: relative;
  overflow: hidden;
  z-index: 0;
}

.sub-container {
  position: absolute;
  width: 100%;
  height: 100%;
}

.vtk-view {
  width: 100%;
  height: 100%;
}
</style>
