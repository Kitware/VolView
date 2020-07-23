<template>
  <div class="vtk-container-wrapper">
    <div class="vtk-gutter"></div>
    <div class="vtk-container" :class="active ? 'active' : ''">
      <div class="vtk-sub-container">
        <div class="vtk-view" ref="vtkContainer" />
      </div>
    </div>
  </div>
</template>

<script>
import { mapGetters, mapState } from 'vuex';

import VtkViewMixin, { attachResizeObserver } from '@/src/mixins/VtkView';

export default {
  name: 'VtkThreeView',

  mixins: [VtkViewMixin],

  computed: {
    ...mapState({
      colorPreset: (state) => state.visualization.baseImageColorPreset,
    }),
    ...mapGetters(['boundsWithSpacing']),
  },

  watch: {
    sceneSources() {
      this.updateOrientation();
      this.resetCamera();
    },
    boundsWithSpacing() {
      this.resetCamera();
    },
    colorPreset(preset) {
      this.setColorPresetAnnotation(preset);
    },
  },

  mounted() {
    this.resizeObserver = attachResizeObserver(
      this.$refs.vtkContainer,
      this.resizeLater
    );
  },

  beforeDestroy() {
    this.resizeObserver.unobserve(this.$refs.vtkContainer);
  },

  methods: {
    afterViewMount() {
      this.view.setBackground(0.1, 0.2, 0.3);
      this.view.setOrientationAxesType('cube');
      this.setColorPresetAnnotation(this.colorPreset);
    },
    setColorPresetAnnotation(preset) {
      if (this.view) {
        this.view.setCornerAnnotation('nw', preset);
      }
    },
  },
};
</script>

<style src="@/src/assets/styles/vtk-view.css"></style>
