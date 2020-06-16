<template>
  <div class="vtk-container-wrapper">
    <div class="vtk-gutter">
      <slice-slider
        class="slice-slider"
        :slice="slice"
        :min="sliceMin"
        :max="sliceMax"
        :handle-height="20"
        @input="setSlice"
      />
    </div>
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
import InteractionPresets from 'vtk.js/Sources/Interaction/Style/InteractorStyleManipulator/Presets';

import VtkViewMixin from '@/src/mixins/VtkView';
import { resize2DCameraToFit } from '@/src/vtk/proxyUtils';

import SliceSlider from './SliceSlider.vue';

export default {
  name: 'VtkTwoView',

  mixins: [VtkViewMixin],

  components: {
    SliceSlider,
  },

  computed: {
    ...mapState({
      resizeToFit: (state) => state.visualization.resizeToFit,
      worldOrientation: (state) => state.visualization.worldOrientation,
      windowing: (state) => state.visualization.window,
      slices: (state) => state.visualization.slices,
    }),
    slice() {
      return this.slices['xyz'[this.axis]];
    },
    sliceMin() {
      const { bounds } = this.worldOrientation;
      return bounds[this.axis * 2];
    },
    sliceMax() {
      const { bounds } = this.worldOrientation;
      return bounds[this.axis * 2 + 1];
    },
  },

  watch: {
    worldOrientation() {
      // update slicing whenever world orientation changes
      this.updateRangeManipulator();
    },
    resizeToFit() {
      this.resizeCameraToFit();
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
      this.resizeListener = this.view.onResize(() => this.resizeCameraToFit());
      this.setupInteraction();
    },

    resizeCameraToFit() {
      if (this.view && this.resizeToFit) {
        const { bounds } = this.worldOrientation;
        resize2DCameraToFit(this.view, bounds);
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
      const { spacing } = this.worldOrientation;
      this.rangeManipulator.setScrollListener(
        this.sliceMin,
        this.sliceMax,
        spacing[this.axis],
        () => this.slice,
        (s) => this.setSlice(s),
      );
    },

    setupInteraction() {
      const istyle = this.view.getInteractorStyle2D();

      // removes all manipulators
      InteractionPresets.applyDefinitions(
        [
          { type: 'pan', options: { shift: true } },
          { type: 'zoom', options: { control: true } },
          { type: 'zoom', options: { button: 3 } },
        ],
        istyle,
      );

      // create our own set of manipulators
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

<style scoped src="@/src/assets/styles/vtk-view.css"></style>
<style scoped>
.vtk-gutter {
  display: flex;
  flex-flow: column;
}

.slice-slider {
  position: relative;
  flex: 1 1;
  width: 20px;
}
</style>
