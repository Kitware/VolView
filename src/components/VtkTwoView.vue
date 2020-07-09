<template>
  <div class="vtk-container-wrapper">
    <div class="vtk-gutter">
      <slice-slider
        class="slice-slider"
        :slice="slice"
        :min="sliceRange[0]"
        :max="sliceRange[1]"
        :step="sliceSpacing"
        :handle-height="20"
        @input="setSlice"
      />
    </div>
    <div class="vtk-container" :class="active ? 'active' : ''">
      <div class="vtk-sub-container">
        <div class="vtk-view" ref="vtkContainer" />
      </div>
    </div>
  </div>
</template>

<script>
import { vec3, mat3 } from 'gl-matrix';
import { mapState, mapGetters, mapActions } from 'vuex';

import vtkMouseRangeManipulator from 'vtk.js/Sources/Interaction/Manipulators/MouseRangeManipulator';
import InteractionPresets from 'vtk.js/Sources/Interaction/Style/InteractorStyleManipulator/Presets';
import { WIDGET_PRIORITY } from 'vtk.js/Sources/Widgets/Core/AbstractWidget/Constants';

import VtkViewMixin from '@/src/mixins/VtkView';
import { resize2DCameraToFit } from '@/src/vtk/proxyUtils';
import { zip } from '@/src/utils/common';
import { NO_SELECTION, NO_WIDGET } from '@/src/constants';

import SliceSlider from './SliceSlider.vue';

const TOL = 10e-6;

function lpsDirToLabels(dir) {
  const [x, y, z] = dir;
  let label = '';
  if (x > TOL) label += 'L';
  else if (x < -TOL) label += 'R';
  if (y > TOL) label += 'P';
  else if (y < -TOL) label += 'A';
  if (z > TOL) label += 'S';
  else if (z < -TOL) label += 'I';
  return label;
}

export default {
  name: 'VtkTwoView',

  mixins: [VtkViewMixin],

  components: {
    SliceSlider,
  },

  inject: ['widgetProvider'],

  computed: {
    ...mapState({
      baseImageExists: (state) => state.selectedBaseImage !== NO_SELECTION,
      worldOrientation: (state) => state.visualization.worldOrientation,
      windowing: (state) => state.visualization.windowing,
      resizeToFit: (state) => state.visualization.resizeToFit,
      slices: (state) => state.visualization.slices,
      activeWidgetID: (state) => state.widgets.activeWidgetID,
      widgetList: (state) => state.widgets.widgetList,
    }),
    ...mapGetters(['boundsWithSpacing']),

    slice() {
      return this.slices['xyz'[this.axis]];
    },
    sliceRange() {
      const { spacing, bounds } = this.worldOrientation;
      return bounds
        .slice(this.axis * 2, (this.axis + 1) * 2)
        .map((b) => b * spacing[this.axis]);
    },
    sliceSpacing() {
      const { spacing } = this.worldOrientation;
      return spacing[this.axis];
    },
  },

  watch: {
    worldOrientation() {
      // update slicing whenever world orientation changes
      this.updateRangeManipulator();
      this.updateLowerLeftAnnotations();
    },
    windowing() {
      this.updateRepresentations();
      this.updateRangeManipulator();
      this.updateLowerLeftAnnotations();
    },
    slice() {
      this.updateRepresentations();
      this.updateLowerLeftAnnotations();
      this.updateActiveWidget();
    },
    resizeToFit() {
      this.resetCamera();
    },
    boundsWithSpacing() {
      this.resetCamera();
    },
    sceneSources() {
      this.updateRepresentations();
      this.resetCamera();
      this.render();
    },
    activeWidgetID(widgetID, oldWidgetID) {
      if (this.view) {
        const wm = this.view.getReferenceByName('widgetManager');

        if (oldWidgetID !== NO_WIDGET) {
          wm.releaseFocus();
        }

        if (widgetID !== NO_WIDGET) {
          const widget = this.widgetProvider.getById(widgetID);
          widget.focus(this.view);
          this.updateActiveWidget();
        }

        this.render();
      }
    },
  },

  created() {
    this.resizeListener = null;
    this.moveListener = null;
    this.rangeManipulator = vtkMouseRangeManipulator.newInstance({
      button: 1,
      scrollEnabled: true,
    });

    this.updateRangeManipulator();
  },

  beforeDestroy() {
    this.cleanupListeners();
  },

  methods: {
    cleanupListeners() {
      if (this.resizeListener) {
        this.resizeListener.unsubscribe();
        this.resizeListener = null;
      }
      if (this.moveListener) {
        this.moveListener.unsubscribe();
        this.moveListener = null;
      }
    },

    beforeViewUnmount() {
      this.widgetProvider.detachView(this.view);
      this.cleanupListeners();
    },

    afterViewMount() {
      this.resizeListener = this.view.onResize(() => this.resetCamera());
      this.moveListener = this.view
        .getInteractor()
        .onMouseMove(() => this.onMouseMove(), WIDGET_PRIORITY);
      this.cameraListener = this.view
        .getCamera()
        .onModified(() => this.updateOrientationLabels());
      // disable orientation widget for 2D views
      this.view.setOrientationAxesVisibility(false);

      this.widgetProvider.addView(this.view);

      this.setupInteraction();
      this.updateOrientationLabels();
      this.updateRepresentations();
    },

    resetCamera() {
      if (this.view) {
        const renderer = this.view.getRenderer();
        renderer.computeVisiblePropBounds();
        renderer.resetCamera(this.boundsWithSpacing);
      }
      this.resizeCameraToFit();
    },

    resizeCameraToFit() {
      if (this.view && this.resizeToFit) {
        resize2DCameraToFit(this.view, this.boundsWithSpacing);
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
        (w) => this.setWindowWidth(w)
      );

      // window level
      this.rangeManipulator.setHorizontalListener(
        this.windowing.min,
        this.windowing.max,
        1 / 512,
        () => this.windowing.level,
        (l) => this.setWindowLevel(l)
      );

      // slicing
      this.rangeManipulator.setScrollListener(
        this.sliceRange[0],
        this.sliceRange[1],
        this.sliceSpacing,
        () => this.slice,
        (s) => this.setSlice(s)
      );
    },

    updateOrientationLabels() {
      const camera = this.view.getCamera();
      // TODO make modifications only if vup and vdir differ
      const vup = camera.getViewUp();
      const vdir = camera.getDirectionOfProjection();
      const vright = [0, 0, 0];
      vec3.cross(vright, vdir, vup);

      // assume direction is orthonormal
      const { direction } = this.worldOrientation;

      // since camera is in "image space", transform into
      // image's world space.
      const cameraMat = mat3.fromValues(...vright, ...vup, ...vdir);
      const imageMat = mat3.fromValues(...direction);
      // `direction` is row-major, and gl-matrix is col-major
      mat3.transpose(imageMat, imageMat);
      const cameraInImWorld = mat3.create();
      mat3.mul(cameraInImWorld, imageMat, cameraMat);

      // gl-matrix is col-major
      const left = cameraInImWorld.slice(0, 3).map((c) => -c);
      const up = cameraInImWorld.slice(3, 6);

      let leftLabels = lpsDirToLabels(left);
      let upLabels = lpsDirToLabels(up);

      // sort by magnitude
      leftLabels = zip(left.map(Math.abs), leftLabels)
        .sort(([a], [b]) => b - a)
        .map(([, label]) => label)
        .join('');
      upLabels = zip(up.map(Math.abs), upLabels)
        .sort(([a], [b]) => b - a)
        .map(([, label]) => label)
        .join('');

      this.view.setCornerAnnotation('n', upLabels);
      this.view.setCornerAnnotation('w', leftLabels);
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
        istyle
      );

      // create our own set of manipulators
      istyle.addMouseManipulator(this.rangeManipulator);
    },

    setWindowWidth(width) {
      if (this.baseImageExists) {
        this.setWindowing({ width });
      }
    },

    setWindowLevel(level) {
      if (this.baseImageExists) {
        this.setWindowing({ level });
      }
    },

    setSlice(slice) {
      this.setSlices({
        ['xyz'[this.axis]]: slice,
      });
    },

    updateRepresentations() {
      if (this.sceneSources.length) {
        // slice and windowing is propagated by proxymanager
        const source = this.sceneSources[0];
        const rep = this.$proxyManager.getRepresentation(source, this.view);
        if (rep) {
          if (rep.setSlice) rep.setSlice(this.slice);
          if (rep.setWindowWidth) rep.setWindowWidth(this.windowing.width);
          if (rep.setWindowLevel) rep.setWindowLevel(this.windowing.level);
        }
      }
    },

    updateLowerLeftAnnotations() {
      if (this.view) {
        const { width, level } = this.windowing;
        const spacing = this.worldOrientation.spacing[this.axis];
        // use index slice, not world slice
        const slice = Math.round(this.slices['xyz'[this.axis]] / spacing);

        this.view.setCornerAnnotation(
          'sw',
          `Slice: ${slice + 1}` +
            `<br>W/L: ${width.toFixed(1)}, ${level.toFixed(1)}`
        );
      }
    },

    onMouseMove() {
      if (this.activeWidgetID !== NO_WIDGET) {
        this.updateActiveWidget();
      }
    },

    updateActiveWidget() {
      const widgetID = this.activeWidgetID;
      if (widgetID !== NO_WIDGET) {
        const widget = this.widgetProvider.getById(widgetID);
        widget.updateManipulator(this.view);
        widget.updateVisibility(this.view);
      }
    },

    ...mapActions(['setWindowing', 'setSlices', 'createPipelineForData']),
  },
};
</script>

<style src="@/src/assets/styles/vtk-view.css"></style>

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
