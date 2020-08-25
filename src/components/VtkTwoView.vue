<template>
  <div class="vtk-container-wrapper">
    <div class="vtk-gutter">
      <slice-slider
        class="slice-slider"
        :slice="slice"
        :min="sliceRange[0]"
        :max="sliceRange[1]"
        :step="1"
        :handle-height="20"
        @input="setSlice"
      />
    </div>
    <div class="vtk-container" :class="active ? 'active' : ''">
      <div class="vtk-sub-container" ref="containerParent"></div>
    </div>
  </div>
</template>

<script>
import { vec3, mat3 } from 'gl-matrix';
import { mapState, mapGetters, mapActions } from 'vuex';

import vtkPlane from 'vtk.js/Sources/Common/DataModel/Plane';
import vtkMouseRangeManipulator from 'vtk.js/Sources/Interaction/Manipulators/MouseRangeManipulator';
import InteractionPresets from 'vtk.js/Sources/Interaction/Style/InteractorStyleManipulator/Presets';
import { WIDGET_PRIORITY } from 'vtk.js/Sources/Widgets/Core/AbstractWidget/Constants';

import VtkViewMixin, { attachResizeObserver } from '@/src/mixins/VtkView';
import { resize2DCameraToFit } from '@/src/vtk/proxyUtils';
import { zip } from '@/src/utils/common';
import { NO_SELECTION, NO_WIDGET, DataTypes } from '@/src/constants';

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

  data() {
    return {
      pixelCoord: [],
      pixel: [],
    };
  },

  computed: {
    ...mapState({
      baseImage: 'selectedBaseImage',
      baseImageExists: (state) => state.selectedBaseImage !== NO_SELECTION,
      worldOrientation: (state) => state.visualization.worldOrientation,
      windowing: (state) => state.visualization.windowing,
      resizeToFit: (state) => state.visualization.resizeToFit,
      slices: (state) => state.visualization.slices,
      activeWidgetID: (state) => state.widgets.activeWidgetID,
      widgetList: (state) => state.widgets.widgetList,
      dataIndex: (state) => state.data.index,
    }),
    ...mapState('dicom', ['patientIndex', 'studyIndex', 'seriesIndex']),
    ...mapGetters(['boundsWithSpacing']),

    slice() {
      return this.slices['xyz'[this.axis]];
    },
    sliceRange() {
      const { bounds } = this.worldOrientation;
      return bounds.slice(this.axis * 2, (this.axis + 1) * 2);
    },
    sliceSpacing() {
      const { spacing } = this.worldOrientation;
      return spacing[this.axis];
    },
  },

  watch: {
    baseImage() {
      this.updateDicomAnnotations();
    },
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
      this.updateAllWidgets();
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

  mounted() {
    this.resizeObserver = attachResizeObserver(
      this.$refs.containerParent,
      this.resizeLater
    );
  },

  beforeDestroy() {
    this.resizeObserver.unobserve(this.$refs.containerParent);
    this.cleanupListeners();
  },

  methods: {
    cleanupListeners() {
      const listeners = ['resizeListener', 'moveListener', 'cameraListener'];
      while (listeners.length) {
        const name = listeners.pop();
        if (this[name]) {
          this[name].unsubscribe();
          this[name] = null;
        }
      }
    },

    beforeViewUnmount() {
      this.cleanupListeners();
    },

    afterViewMount() {
      this.resizeListener = this.view.onResize(() => this.resetCamera());
      this.moveListener = this.view
        .getInteractor()
        .onMouseMove((ev) => this.onMouseMove(ev), WIDGET_PRIORITY);
      this.cameraListener = this.view
        .getCamera()
        .onModified(() => this.updateOrientationLabels());
      // disable orientation widget for 2D views
      this.view.setOrientationAxesVisibility(false);

      this.widgetProvider.addView(this.view);

      this.setupInteraction();
      this.updateOrientationLabels();
      this.updateRepresentations();
      this.updateLowerLeftAnnotations();
      this.updateDicomAnnotations();
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
        1,
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
          if (rep.setSlice) rep.setSlice(this.slice * this.sliceSpacing);
          if (rep.setWindowWidth) rep.setWindowWidth(this.windowing.width);
          if (rep.setWindowLevel) rep.setWindowLevel(this.windowing.level);
        }
      }
    },

    updateDicomAnnotations() {
      if (this.view && this.baseImage !== NO_SELECTION) {
        const dataInfo = this.dataIndex[this.baseImage];
        let upperLeftAnnot = '';
        let upperRightAnnot = '';
        if (dataInfo.type === DataTypes.Dicom) {
          const { patientKey, studyKey, seriesKey } = dataInfo;
          const patient = this.patientIndex[patientKey];
          const study = this.studyIndex[studyKey];
          const series = this.seriesIndex[seriesKey];
          upperLeftAnnot = [
            patient.PatientName,
            `ID: ${patient.PatientID}`,
          ].join('<br>');
          upperRightAnnot = [
            `Study ID: ${study.StudyID}`,
            study.StudyDescription,
            `Series #: ${series.SeriesNumber}`,
            series.SeriesDescription,
          ].join('<br>');
        }
        this.view.setCornerAnnotation('nw', upperLeftAnnot);
        this.view.setCornerAnnotation('ne', upperRightAnnot);
      }
    },

    updateLowerLeftAnnotations() {
      if (this.view) {
        const { width, level } = this.windowing;

        let pixelInfo = 'NONE';
        if (this.pixelCoord.length && this.pixel.length) {
          pixelInfo =
            `(${this.pixelCoord.map((c) => Math.round(c)).join(', ')}) = ` +
            `${this.pixel.map((p) => p.toFixed(1)).join(', ')}`;
        }

        this.view.setCornerAnnotation(
          'sw',
          `Slice: ${this.slice + 1}` +
            `<br>W/L: ${width.toFixed(1)}, ${level.toFixed(1)}` +
            `<br>Pixel: ${pixelInfo}`
        );
      }
    },

    onMouseMove(ev) {
      if (this.activeWidgetID !== NO_WIDGET) {
        this.updateActiveWidget();
      }
      this.findPixelUnderCursor(ev);
      this.updateLowerLeftAnnotations();
    },

    updateAllWidgets() {
      this.widgetList.forEach((widgetID) => {
        const widget = this.widgetProvider.getById(widgetID);
        widget.update();
      });
    },

    updateActiveWidget() {
      const widgetID = this.activeWidgetID;
      if (widgetID !== NO_WIDGET) {
        const widget = this.widgetProvider.getById(widgetID);
        widget.setCurrentView(this.view);
        widget.update();
      }
    },

    findPixelUnderCursor(ev) {
      if (
        this.baseImageExists &&
        ev.pokedRenderer === this.view.getRenderer()
      ) {
        const { x, y } = ev.position;
        const gl = this.view.getOpenglRenderWindow();
        const near = gl.displayToWorld(x, y, 0, ev.pokedRenderer);
        const far = gl.displayToWorld(x, y, 1, ev.pokedRenderer);
        const dop = this.view.getCamera().getDirectionOfProjection();
        const origin = [0, 0, 0];
        origin[this.axis] = this.slice * this.sliceSpacing;
        const intInfo = vtkPlane.intersectWithLine(near, far, origin, dop);
        if (intInfo.intersection) {
          const point = intInfo.x;
          // get image data
          const rep = this.$proxyManager.getRepresentation(
            this.sceneSources[0],
            this.view
          );
          if (rep) {
            const imageData = rep.getMapper().getInputData();
            const [i, j, k] = imageData.worldToIndex(point).map((c) =>
              // this is a hack to work around the first slice sometimes being
              // very close to zero, but not quite, resulting in being unable to
              // see pixel values for 0th slice.
              Math.abs(c) < 1e-8 ? Math.round(c) : c
            );
            const extent = imageData.getExtent();
            if (
              i >= extent[0] &&
              i <= extent[1] &&
              j >= extent[2] &&
              j <= extent[3] &&
              k >= extent[4] &&
              k <= extent[5]
            ) {
              const offsetIndex = imageData.computeOffsetIndex([i, j, k]);
              const pixel = imageData
                .getPointData()
                .getScalars()
                .getTuple(offsetIndex);

              this.pixelCoord = [i, j, k];
              this.pixel = pixel;

              this.updateLowerLeftAnnotations();
              return;
            }
          }
        }
        this.pixelCoord = [];
        this.pixel = [];
      }
    },

    ...mapActions(['setWindowing', 'setSlices']),
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
