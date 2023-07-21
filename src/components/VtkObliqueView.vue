<template>
  <div
    class="vtk-container-wrapper"
    tabindex="0"
    @pointerenter="hover = true"
    @pointerleave="hover = false"
    @focusin="hover = true"
    @focusout="hover = false"
  >
    <div class="vtk-gutter">
      <v-btn dark icon size="medium" variant="text" @click="enableResizeToFit">
        <v-icon size="medium" class="py-1">mdi-camera-flip-outline</v-icon>
        <v-tooltip
          location="right"
          activator="parent"
          transition="slide-x-transition"
        >
          Reset Camera
        </v-tooltip>
      </v-btn>
      <slice-slider
        class="slice-slider"
        :slice="currentSlice"
        :min="sliceMin"
        :max="sliceMax"
        :step="1"
        :handle-height="20"
        @input="setSlice"
      />
    </div>
    <div class="vtk-container" :class="active ? 'active' : ''">
      <div class="vtk-sub-container">
        <div class="vtk-view" ref="vtkContainerRef" />
      </div>
      <div class="overlay-no-events tool-layer" ref="toolContainer">
        <pan-tool :view-id="viewID" />
        <zoom-tool :view-id="viewID" />
        <reslice-cursor-tool :view-id="viewID" :view-direction="viewDirection" />
        <slice-scroll-tool :view-id="viewID" />
        <window-level-tool :view-id="viewID" />
      </div>
      <view-overlay-grid class="overlay-no-events view-annotations">
        <template v-slot:bottom-left>
          <div class="annotation-cell">
            <div>Slice: {{ currentSlice }}/{{ sliceMax }}</div>
            <div
              v-if="
                windowWidth != null &&
                windowLevel != null
              "
            >
              W/L: {{ windowWidth.toFixed(2) }} / {{ windowLevel.toFixed(2) }}
            </div>
          </div>
        </template>
        <template v-slot:top-right>
          <div class="annotation-cell">
            <v-menu
              open-on-hover
              location="bottom left"
              left
              nudge-left="10"
              dark
              v-if="dicomInfo !== null"
              max-width="300px"
            >
              <template v-slot:activator="{ props }">
                <v-icon
                  v-bind="props"
                  dark
                  size="x-large"
                  class="pointer-events-all hover-info"
                >
                  mdi-information
                </v-icon>
              </template>
              <v-list class="bg-grey-darken-3">
                <v-list-item>
                  <v-list-item-title class="font-weight-bold">
                    PATIENT / CASE
                  </v-list-item-title>
                  <v-divider />
                  <v-list-item-title>
                    ID: {{ dicomInfo.patientID }}
                  </v-list-item-title>
                </v-list-item>
                <v-list-item>
                  <v-list-item-title class="font-weight-bold">
                    STUDY
                  </v-list-item-title>
                  <v-divider />
                  <v-list-item-title>
                    ID: {{ dicomInfo.studyID }}
                  </v-list-item-title>
                  <v-list-item-title>
                    {{ dicomInfo.studyDescription }}
                  </v-list-item-title>
                </v-list-item>
                <v-list-item>
                  <v-list-item-title class="font-weight-bold">
                    SERIES
                  </v-list-item-title>
                  <v-divider />
                  <v-list-item-title>
                    Series #: {{ dicomInfo.seriesNumber }}
                  </v-list-item-title>
                  <v-list-item-title>
                    {{ dicomInfo.seriesDescription }}
                  </v-list-item-title>
                </v-list-item>
              </v-list>
            </v-menu>
          </div>
        </template>
      </view-overlay-grid>
      <transition name="loading">
        <div v-if="isImageLoading" class="overlay-no-events loading">
          <div>Loading the image</div>
          <div>
            <v-progress-circular indeterminate color="blue" />
          </div>
        </div>
      </transition>
    </div>
  </div>
</template>

<script lang="ts">
import {
  computed,
  defineComponent,
  inject,
  onBeforeMount,
  onBeforeUnmount,
  onMounted,
  PropType,
  provide,
  ref,
  toRefs,
  watch,
  watchEffect,
} from 'vue';
import { vec3 } from 'gl-matrix';
import { onKeyStroke } from '@vueuse/core';

import type { Vector3 } from '@kitware/vtk.js/types';
import vtkMatrixBuilder from '@kitware/vtk.js/Common/Core/MatrixBuilder';
import { useResizeToFit } from '@src/composables/useResizeToFit';
import vtkLPSView2DProxy from '@src/vtk/LPSView2DProxy';
import vtkResliceRepresentationProxy from '@kitware/vtk.js/Proxy/Representations/ResliceRepresentationProxy';
import { SlabTypes } from '@kitware/vtk.js/Rendering/Core/ImageResliceMapper/Constants';
import { ViewTypes } from '@kitware/vtk.js/Widgets/Core/WidgetManager/Constants';
import { ResliceCursorWidgetState } from '@kitware/vtk.js/Widgets/Widgets3D/ResliceCursorWidget';
import { useVTKCallback } from '@/src/composables/useVTKCallback';
import { manageVTKSubscription } from '@src/composables/manageVTKSubscription';
import SliceSlider from '@src/components/SliceSlider.vue';
import ViewOverlayGrid from '@src/components/ViewOverlayGrid.vue';
import { useResizeObserver } from '../composables/useResizeObserver';
import { getLPSAxisFromDir } from '../utils/lps';
import { useCurrentImage } from '../composables/useCurrentImage';
import { useCameraOrientation } from '../composables/useCameraOrientation';
import WindowLevelTool from './tools/WindowLevelTool.vue';
import SliceScrollTool from './tools/SliceScrollTool.vue';
import PanTool from './tools/PanTool.vue';
import ZoomTool from './tools/ZoomTool.vue';
import ResliceCursorTool from './tools/ResliceCursorTool.vue';
import { useSceneBuilder } from '../composables/useSceneBuilder';
import { useDICOMStore } from '../store/datasets-dicom';
import useWindowingStore from '../store/view-configs/windowing';
import { LPSAxisDir } from '../types/lps';
import { ViewProxyType } from '../core/proxies';
import { useViewProxy } from '../composables/useViewProxy';
import { useWidgetManager } from '../composables/useWidgetManager';
import useViewSliceStore, {
  defaultSliceConfig,
} from '../store/view-configs/slicing';
import { ToolContainer, VTKTwoViewWidgetManager, VTKResliceCursor } from '../constants';

const SLICE_OFFSET_KEYS: Record<string, number> = {
  ArrowLeft: -1,
  ArrowRight: 1,
  ArrowUp: -1,
  ArrowDown: 1,
} as const;

export default defineComponent({
  name: 'VtkObliqueView',
  props: {
    id: {
      type: String,
      required: true,
    },
    viewDirection: {
      type: String as PropType<LPSAxisDir>,
      required: true,
    },
    viewUp: {
      type: String as PropType<LPSAxisDir>,
      required: true,
    },
  },
  components: {
    SliceSlider,
    ViewOverlayGrid,
    WindowLevelTool,
    SliceScrollTool,
    PanTool,
    ZoomTool,
    ResliceCursorTool
  },
  setup(props) {
    const windowingStore = useWindowingStore();
    const viewSliceStore = useViewSliceStore();

    const { id: viewID, viewDirection, viewUp } = toRefs(props);

    const vtkContainerRef = ref<HTMLElement>();

    const viewAxis = computed(() => getLPSAxisFromDir(viewDirection.value));

    // --- computed vars --- //

    const {
      currentImageData: curImageData,
      currentImageID: curImageID,
      currentImageMetadata: curImageMetadata,
      isImageLoading,
    } = useCurrentImage();

    const dicomStore = useDICOMStore();

    const sliceConfigDefaults = defaultSliceConfig();
    const sliceConfig = computed(() =>
      viewSliceStore.getConfig(viewID.value, curImageID.value)
    );
    const currentSlice = computed(
      () => sliceConfig.value?.slice ?? sliceConfigDefaults.slice
    );
    const sliceMin = computed(
      () => sliceConfig.value?.min ?? sliceConfigDefaults.min
    );
    const sliceMax = computed(
      () => sliceConfig.value?.max ?? sliceConfigDefaults.max
    );

    const wlConfig = computed({
      get: () => windowingStore.getConfig(viewID.value, curImageID.value),
      set: (newValue) => {
        const imageID = curImageID.value;
        if (imageID !== null && newValue != null) {
          windowingStore.updateConfig(viewID.value, imageID, newValue);
        }
      },
    });

    const windowWidth = computed(() => wlConfig.value?.width);
    const windowLevel = computed(() => wlConfig.value?.level);
    const dicomInfo = computed(() => {
      if (
        curImageID.value !== null &&
        curImageID.value in dicomStore.imageIDToVolumeKey
      ) {
        const volumeKey = dicomStore.imageIDToVolumeKey[curImageID.value];
        const volumeInfo = dicomStore.volumeInfo[volumeKey];
        const studyKey = dicomStore.volumeStudy[volumeKey];
        const studyInfo = dicomStore.studyInfo[studyKey];
        const patientKey = dicomStore.studyPatient[studyKey];
        const patientInfo = dicomStore.patientInfo[patientKey];

        const patientID = patientInfo.PatientID;
        const studyID = studyInfo.StudyID;
        const studyDescription = studyInfo.StudyDescription;
        const seriesNumber = volumeInfo.SeriesNumber;
        const seriesDescription = volumeInfo.SeriesDescription;

        return {
          patientID,
          studyID,
          studyDescription,
          seriesNumber,
          seriesDescription,
        };
      }

      return null;
    });

    // --- setters --- //

    const setSlice = (slice: number) => {
      if (curImageID.value !== null) {
        viewSliceStore.updateConfig(viewID.value, curImageID.value, {
          slice,
        });
      }
    };

    // --- view proxy setup --- //

    const { viewProxy, setContainer: setViewProxyContainer } =
      useViewProxy<vtkLPSView2DProxy>(viewID, ViewProxyType.Oblique);

    const resliceCursorRef = inject(VTKResliceCursor);
    if (!resliceCursorRef) {
      throw Error('Cannot access global ResliceCursor instance.');
    }

    const VTKViewType = computed(() => {
      const viewAxisValue = viewAxis?.value;
      switch(viewAxisValue) {
        case 'Coronal': return ViewTypes.XZ_PLANE;
        case 'Sagittal': return ViewTypes.YZ_PLANE;
        default:
          return ViewTypes.XY_PLANE;
      }
    });

    const { baseImageRep } = useSceneBuilder<
      vtkResliceRepresentationProxy
    >(viewID, {
      baseImage: curImageID
    });

    onBeforeMount(() => {
      // do this before mount, as the ManipulatorTools run onMounted
      // before this component does.
      viewProxy.value.getInteractorStyle2D().removeAllManipulators();
    });

    const updateViewFromResliceCursor = () => {
      const rep = baseImageRep?.value;
      const resliceCursor = resliceCursorRef?.value;
      const state = resliceCursor?.getWidgetState() as ResliceCursorWidgetState;
      if (resliceCursor && rep) {
        const planeOrigin = state.getCenter();
        const planeNormal = resliceCursorRef.value.getPlaneNormalFromViewType(VTKViewType.value);
        rep.getSlicePlane().setNormal(planeNormal);
        rep.getSlicePlane().setOrigin(planeOrigin);
        if (curImageData.value) {
          resliceCursorRef.value.updateCameraPoints( viewProxy.value.getRenderer(), VTKViewType.value, false, false, true);
        }
      }
    }

    onMounted(() => {
      setViewProxyContainer(vtkContainerRef.value);
      viewProxy.value.setOrientationAxesVisibility(false);

      // Initialize camera points during construction
      if (curImageData.value) {
        resliceCursorRef.value.updateCameraPoints(viewProxy.value.getRenderer(), VTKViewType.value, true, false, true);
      }

      const onPlanesUpdated = useVTKCallback(
        resliceCursorRef.value.getWidgetState().onModified
      );

      onPlanesUpdated(() => {
        updateViewFromResliceCursor();
      });
    });

    onBeforeUnmount(() => {
      setViewProxyContainer(null);
    });

    // --- apply windowing and slice configs --- //

    function roundTo2Decimals(x: number): number {
      return Math.round(x * 100) / 100;
    }

    // Function to compute float range of slicing for oblique slicing.
    // Range is calculated as distance along the plane normal (as originating from {0,0,0} ).
    function slicePlaneRange(cornerPoints: number[][], sliceNormal: number[]): [number, number] {
      if (!cornerPoints || !sliceNormal)
        return [0, 1];

      // Get rotation matrix from normal to +X (since bounds is aligned to XYZ)
      const transform = vtkMatrixBuilder
        .buildFromDegree()
        .identity()
        .rotateFromDirections(sliceNormal, [1, 0, 0]);

      const corners = cornerPoints.map(x => x.slice());
      corners.forEach((pt) => transform.apply(pt));

      // range is now maximum X distance
      let minX = Infinity;
      let maxX = -Infinity;
      for (let i = 0; i < 8; i++) {
        const x = corners[i][0];
        if (x > maxX) {
          maxX = x;
        }
        if (x < minX) {
          minX = x;
        }
      }

      return [roundTo2Decimals(minX), roundTo2Decimals(maxX)];
    }

    // --- Slicing setup --- //

    // --- arrows change slice --- //

    const hover = ref(false);
    const onKeyDown = (event: KeyboardEvent) => {
      if (!curImageID.value || !hover.value) return;

      const sliceOffset = SLICE_OFFSET_KEYS[event.key] ?? 0;
      if (sliceOffset) {
        viewSliceStore.updateConfig(viewID.value, curImageID.value, {
          slice: currentSlice.value + sliceOffset,
        });

        event.stopPropagation();
      }
    };
    onKeyStroke(Object.keys(SLICE_OFFSET_KEYS), onKeyDown);

    // --- resizing --- //

    useResizeObserver(vtkContainerRef, () => viewProxy.value.resize());

    // Used by SVG tool widgets for resizeCallback
    const toolContainer = ref<HTMLElement>();
    provide(ToolContainer, toolContainer);

    // --- widget manager --- //

    const { widgetManager } = useWidgetManager(viewProxy);
    provide(VTKTwoViewWidgetManager, widgetManager);

    // --- window/level setup --- //

    watch(
      curImageData,
      (imageData) => {
        if (curImageID.value == null || wlConfig.value != null || !imageData) {
          return;
        }

        updateViewFromResliceCursor();

        // TODO listen to changes in point data
        const range = imageData.getPointData().getScalars().getRange();
        windowingStore.updateConfig(viewID.value, curImageID.value, {
          min: range[0],
          max: range[1],
        });
        windowingStore.resetWindowLevel(viewID.value, curImageID.value);
      },
      {
        immediate: true,
      }
    );

    // --- scene setup --- //

    const { cameraDirVec, cameraUpVec } = useCameraOrientation(
      viewDirection,
      viewUp,
      curImageMetadata
    );

    const imageCorners = computed(() => {
      const image = curImageData.value;
      const [xmin, xmax, ymin, ymax, zmin, zmax] = image?.getExtent() ?? [0, 1, 0, 1, 0, 1];
      const corners = [
        [xmin, ymin, zmin],
        [xmax, ymin, zmin],
        [xmin, ymax, zmin],
        [xmax, ymax, zmin],
        [xmin, ymin, zmax],
        [xmax, ymin, zmax],
        [xmin, ymax, zmax],
        [xmax, ymax, zmax]
      ];
      corners.forEach(p => image?.indexToWorld(p as vec3, p as vec3));
      return corners;
    });

    const sliceDomain = computed(() => {
      const [...sliceNormal] = cameraDirVec?.value ?? [0, 0, 1];
      const range = slicePlaneRange(imageCorners?.value, sliceNormal);
      return {
        min: range[0],
        max: range[1],
      };
    });

    watch(
      [viewID, curImageID, viewDirection],
      ([viewID_, imageID, viewDir]) => {
        if (!imageID || sliceConfig.value != null) {
          return;
        }

        viewSliceStore.updateConfig(viewID_, imageID, {
          ...sliceDomain.value,
          axisDirection: viewDir,
        });
        viewSliceStore.resetSlice(viewID_, imageID);
      },
      { immediate: true }
    );

    // --- camera setup --- //
    
    // Set default cutting plane parameters.

    watch([baseImageRep, cameraDirVec], () => {
      const rep = baseImageRep?.value;
      if (rep) {
        if (cameraDirVec) {
          const planeNormal: Vector3 = [cameraDirVec.value[0], cameraDirVec.value[1], cameraDirVec.value[2]];
          rep.getSlicePlane().setNormal(planeNormal);
        }
        rep.setSlabType(SlabTypes.MAX);
        rep.setSlabThickness(1);
      }
    });

    const { resizeToFit, ignoreResizeToFitTracking, resetResizeToFitTracking } =
      useResizeToFit(viewProxy.value.getCamera(), false);

    const resizeToFitScene = () =>
      ignoreResizeToFitTracking(() => {
        // resize to fit
        const lookAxis =
          curImageMetadata.value.lpsOrientation[
            getLPSAxisFromDir(viewDirection.value)
          ];
        const upAxis =
          curImageMetadata.value.lpsOrientation[
            getLPSAxisFromDir(viewUp.value)
          ];
        const dimsWithSpacing = curImageMetadata.value.dimensions.map(
          (d, i) => d * curImageMetadata.value.spacing[i]
        );
        viewProxy.value.resizeToFit(lookAxis, upAxis, dimsWithSpacing);
        resetResizeToFitTracking();
      });

    const resetCamera = () => {
      const bounds = curImageMetadata.value.worldBounds;
      const center = [
        (bounds[0] + bounds[1]) / 2,
        (bounds[2] + bounds[3]) / 2,
        (bounds[4] + bounds[5]) / 2,
      ] as vec3;

      // do not track resizeToFit state
      ignoreResizeToFitTracking(() => {
        viewProxy.value.updateCamera(
          cameraDirVec.value,
          cameraUpVec.value,
          center
        );
        viewProxy.value.resetCamera(bounds);
      });

      resizeToFitScene();

      viewProxy.value.renderLater();
    };

    manageVTKSubscription(
      viewProxy.value.onResize(() => {
        if (resizeToFit.value) {
          resizeToFitScene();
        }
      })
    );

    // if we re-enable resizeToFit, reset the camera
    watch(resizeToFit, () => {
      if (resizeToFit.value) {
        resetCamera();
      }
    });

    watch(
      [curImageID, cameraDirVec, cameraUpVec],
      () => {
        // If we have a saved camera configuration restore it
        if (resizeToFit.value) {
          resetCamera();
        } else {
          // this will trigger a resetCamera() call
          resizeToFit.value = true;
        }
      },
      { immediate: true, deep: true }
    );

    // --- viewport orientation/camera labels --- //

    watchEffect(() => {
      if (sliceConfig.value == null || wlConfig.value == null) {
        return;
      }

      const { width, level } = wlConfig.value;
      const rep = baseImageRep.value;

      if (rep) {
        rep.setWindowWidth(width);
        rep.setWindowLevel(level);
      }

      viewProxy.value.renderLater();
    });

    return {
      vtkContainerRef,
      toolContainer,
      viewID,
      viewProxy,
      viewAxis,
      active: true,
      currentSlice,
      sliceMin,
      sliceMax,
      windowWidth,
      windowLevel,
      isImageLoading,
      setSlice,
      widgetManager,
      dicomInfo,
      enableResizeToFit() {
        resizeToFit.value = true;
      },
      hover,
    };
  },
});
</script>

<style scoped src="@/src/components/styles/vtk-view.css"></style>
<style scoped src="@/src/components/styles/utils.css"></style>
<style scoped>
.hover-info {
  width: 32px;
  height: 32px;
  cursor: pointer;
}
</style>
