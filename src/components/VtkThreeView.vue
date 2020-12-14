<template>
  <div class="vtk-container-wrapper">
    <div class="vtk-gutter"></div>
    <div class="vtk-container" :class="active ? 'active' : ''">
      <div class="vtk-sub-container" ref="containerParent"></div>
    </div>
  </div>
</template>

<script>
import { mapGetters } from 'vuex';

import VtkViewMixin, { attachResizeObserver } from '@/src/mixins/VtkView';

export default {
  name: 'VtkThreeView',

  mixins: [VtkViewMixin],

  computed: {
    ...mapGetters('visualization', [
      'boundsWithSpacing',
      'baseImageColorPreset',
    ]),
  },

  watch: {
    sceneSources() {
      this.updateOrientation();
      this.resetCamera();
    },
    boundsWithSpacing() {
      this.resetCamera();
    },
    baseImageColorPreset(preset) {
      this.setColorPresetAnnotation(preset);
    },
  },

  mounted() {
    this.resizeObserver = attachResizeObserver(
      this.$refs.containerParent,
      this.resizeLater
    );
  },

  beforeDestroy() {
    this.resizeObserver.unobserve(this.$refs.containerParent);
  },

  methods: {
    afterViewMount() {
      this.view.setBackground(0.1, 0.2, 0.3);
      this.view.setOrientationAxesType('cube');
      this.setColorPresetAnnotation(this.baseImageColorPreset);
    },
    setColorPresetAnnotation(preset) {
      if (this.view) {
        this.view.setCornerAnnotation('nw', preset || 'No colormap');
      }
    },
  },
};
</script>

<style src="@/src/assets/styles/vtk-view.css"></style>
