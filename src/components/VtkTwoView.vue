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
import { mapState, mapActions } from 'vuex';

import vtkMouseRangeManipulator from 'vtk.js/Sources/Interaction/Manipulators/MouseRangeManipulator';

import VtkViewMixin from '@/src/mixins/VtkView';
import { resize2DCameraToFit } from '@/src/vtk/proxyUtils';

export default {
  name: 'VtkTwoView',

  mixins: [VtkViewMixin],

  computed: {
    ...mapState({
      resizeToFit: (state) => state.visualization.resizeToFit,
      worldOrientation: (state) => state.visualization.worldOrientation,
      windowing: (state) => state.visualization.window,
      slices: (state) => state.visualization.slices,
    }),
  },

  watch: {
    worldOrientation() {
      // update slicing whenever world orientation changes
      this.updateRangeManipulator();
    },
  },

  created() {
    this.resizeListener = null;
    this.rangeManipulator = vtkMouseRangeManipulator.newInstance({
      button: 1,
      scrollEnabled: true,
    });

    this.updateRangeManipulator();
  },

  beforeDestroy() {
    if (this.resizeListener) {
      this.resizeListener.unsubscribe();
    }
  },

  methods: {
    beforeViewUnmount() {
      if (this.resizeListener) {
        this.resizeListener.unsubscribe();
        this.resizeListener = null;
      }
    },

    afterViewMount() {
      this.resizeListener = this.view.onResize(this.tryResizingToFit);
      this.setupInteraction();
    },

    tryResizingToFit() {
      if (this.view && this.resizeToFit) {
        const { spacing } = this.worldOrientation;
        const size = this.worldOrientation
          .bounds
          .map((d, i) => (d - 1) * spacing[i])
          .filter((_, i) => i !== this.axis);

        resize2DCameraToFit(this.view, size);
      }
    },

    updateRangeManipulator() {
      this.rangeManipulator.removeAllListeners();

      // window width
      this.rangeManipulator.setVerticalListener(
        0,
        this.windowing.max - this.windowing.min,
        1 / 512,
        () => this.windowing.width,
        (w) => this.setWindowWidth(w),
      );

      // window level
      this.rangeManipulator.setHorizontalListener(
        this.windowing.min,
        this.windowing.max,
        1 / 512,
        () => this.windowing.level,
        (l) => this.setWindowLevel(l),
      );

      // slicing
      const axialBounds = this.worldOrientation.bounds[this.axis];
      const axialSpacing = this.worldOrientation.spacing[this.axis];
      this.rangeManipulator.setScrollListener(
        0,
        axialBounds * axialSpacing,
        axialSpacing,
        () => this.slices['xyz'[this.axis]],
        (s) => this.setSlice(s),
      );
    },

    setupInteraction() {
      const istyle = this.view.getInteractorStyle2D();
      // create our own set of manipulators
      istyle.removeAllMouseManipulators();
      istyle.removeAllKeyboardManipulators();
      istyle.addMouseManipulator(this.rangeManipulator);
    },

    setWindowWidth(width) {
      this.setWindowing({ width });
    },

    setWindowLevel(level) {
      this.setWindowing({ level });
    },

    setSlice(slice) {
      this.setSlices({
        ['xyz'[this.axis]]: slice,
      });
    },

    ...mapActions(['setWindowing', 'setSlices']),
  },
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
