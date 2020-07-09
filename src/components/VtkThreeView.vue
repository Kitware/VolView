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

import VtkViewMixin from '@/src/mixins/VtkView';

export default {
  name: 'VtkThreeView',

  mixins: [VtkViewMixin],

  computed: {
    ...mapState({
      presetName: (state) => state.visualization.baseImageColorPreset,
    }),
    ...mapGetters(['boundsWithSpacing', 'baseImagePipeline']),
    baseImageColorBy() {
      if (this.baseImagePipeline) {
        const { transformFilter } = this.baseImagePipeline;
        const rep = this.$proxyManager.getRepresentation(
          transformFilter,
          this.view
        );
        if (rep) {
          return rep.getColorBy();
        }
      }
      return [];
    },
  },

  watch: {
    sceneSources() {
      this.updateOrientation();
      this.resetCamera();
    },
    boundsWithSpacing() {
      this.resetCamera();
    },
    presetName() {
      this.updateColorTransferFunction();
    },
    baseImageColorBy() {
      this.updateColorTransferFunction();
    },
  },

  methods: {
    afterViewMount() {
      this.view.setBackground(0.1, 0.2, 0.3);
      this.view.setCornerAnnotation('nw', 'ColorMap');
      this.view.setOrientationAxesType('cube');

      this.updateColorTransferFunction();
    },

    updateColorTransferFunction() {
      const [name, location] = this.baseImageColorBy;
      if (name && location) {
        const lut = this.$proxyManager.getLookupTable(name);
        lut.setPresetName(this.presetName);
      }
    },
  },
};
</script>

<style src="@/src/assets/styles/vtk-view.css"></style>
