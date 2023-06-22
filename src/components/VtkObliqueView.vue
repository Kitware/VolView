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
        <slice-scroll-tool :view-id="viewID" />
        <window-level-tool :view-id="viewID" />
      </div>
      <view-overlay-grid class="overlay-no-events view-annotations">
        <template v-slot:top-middle>
          <div class="annotation-cell">
            <span>{{ topLabel }}</span>
          </div>
        </template>
        <template v-slot:middle-left>
          <div class="annotation-cell">
            <span>{{ leftLabel }}</span>
          </div>
        </template>
        <template v-slot:bottom-left>
          <div class="annotation-cell">
            <div>Slice: {{ currentSlice }}/{{ sliceMax }}</div>
            <div
              v-if="
                typeof windowWidth === 'number' &&
                typeof windowLevel === 'number'
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
import { getCenter } from '@kitware/vtk.js/Common/DataModel/BoundingBox';
import vtkMatrixBuilder from '@kitware/vtk.js/Common/Core/MatrixBuilder';
import vtkMath from '@kitware/vtk.js/Common/Core/Math';
import { useResizeToFit } from '@src/composables/useResizeToFit';
import vtkLPSView2DProxy from '@src/vtk/LPSView2DProxy';
import vtkIJKSliceRepresentationProxy from '@src/vtk/IJKSliceRepresentationProxy';
import vtkResliceRepresentationProxy from '@kitware/vtk.js/Proxy/Representations/ResliceRepresentationProxy';
import { SlabTypes } from '@kitware/vtk.js/Rendering/Core/ImageResliceMapper/Constants';
import vtkPiecewiseFunctionProxy from '@kitware/vtk.js/Proxy/Core/PiecewiseFunctionProxy';
import { Mode as LookupTableProxyMode } from '@kitware/vtk.js/Proxy/Core/LookupTableProxy';
import { manageVTKSubscription } from '@src/composables/manageVTKSubscription';
import SliceSlider from '@src/components/SliceSlider.vue';
import ViewOverlayGrid from '@src/components/ViewOverlayGrid.vue';
import { useResizeObserver } from '../composables/useResizeObserver';
import { useOrientationLabels } from '../composables/useOrientationLabels';
import { getLPSAxisFromDir } from '../utils/lps';
import { useCurrentImage } from '../composables/useCurrentImage';
import { useCameraOrientation } from '../composables/useCameraOrientation';
import WindowLevelTool from './tools/WindowLevelTool.vue';
import SliceScrollTool from './tools/SliceScrollTool.vue';
import PanTool from './tools/PanTool.vue';
import ZoomTool from './tools/ZoomTool.vue';
import { useSceneBuilder } from '../composables/useSceneBuilder';
import { useDICOMStore } from '../store/datasets-dicom';
import { useLabelmapStore } from '../store/datasets-labelmaps';
import vtkLabelMapSliceRepProxy from '../vtk/LabelMapSliceRepProxy';
import { usePaintToolStore } from '../store/tools/paint';
import useWindowingStore from '../store/view-configs/windowing';
import { usePersistCameraConfig } from '../composables/usePersistCameraConfig';
import { LPSAxisDir } from '../types/lps';
import { ViewProxyType } from '../core/proxies';
import { useViewProxy } from '../composables/useViewProxy';
import { useWidgetManager } from '../composables/useWidgetManager';
import useViewSliceStore, {
  defaultSliceConfig,
} from '../store/view-configs/slicing';
import { ToolContainer, VTKTwoViewWidgetManager } from '../constants';
import { useProxyManager } from '../composables/proxyManager';
import { getShiftedOpacityFromPreset } from '../utils/vtk-helpers';
import { useLayersStore } from '../store/datasets-layers';
import { useViewCameraStore } from '../store/view-configs/camera';
import useLayerColoringStore from '../store/view-configs/layers';

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
      // type: vec3,
      required: true,
    },
    viewUp: {
      type: String as PropType<LPSAxisDir>,
      // type: vec3,
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
  },
  setup(props) {
    const windowingStore = useWindowingStore();
    const viewSliceStore = useViewSliceStore();
    const viewCameraStore = useViewCameraStore();
    const layerColoringStore = useLayerColoringStore();
    const paintStore = usePaintToolStore();

    const { id: viewID, viewDirection, viewUp } = toRefs(props);

    const vtkContainerRef = ref<HTMLElement>();

    const viewAxis = computed(() => getLPSAxisFromDir(viewDirection.value));

    // --- computed vars --- //

    const {
      currentImageData: curImageData,
      currentImageID: curImageID,
      currentImageMetadata: curImageMetadata,
      isImageLoading,
      currentLayers,
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

    onBeforeMount(() => {
      // do this before mount, as the ManipulatorTools run onMounted
      // before this component does.
      viewProxy.value.getInteractorStyle2D().removeAllManipulators();
    });

    onMounted(() => {
      setViewProxyContainer(vtkContainerRef.value);
      viewProxy.value.setOrientationAxesVisibility(false);
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
    // function slicePlaneRange(bounds: Bounds, sliceNormal: number[]): [number, number] {
    function slicePlaneRange(cornerPoints: number[][], sliceNormal: number[]): [number, number] {
      if (!cornerPoints || !sliceNormal)
        return [0, 1];

      // Get rotation matrix from normal to +X (since bounds is aligned to XYZ)
      const transform = vtkMatrixBuilder
        .buildFromDegree()
        .identity()
        .rotateFromDirections(sliceNormal, [1, 0, 0]);

      // Array.from(cornerPoints).forEach((pt) => transform.apply(pt));
      // const corners = Array.from(cornerPoints);
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

    /*
    watchEffect(() => {
      const ijkIndex = curImageMetadata.value.lpsOrientation[viewAxis.value];
      viewProxy.value.setSlicingMode('IJK'[ijkIndex]);
    });
    */

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

    const labelmapStore = useLabelmapStore();

    const labelmapIDs = computed(() => {
      return labelmapStore.idList.filter(
        (id) => labelmapStore.parentImage[id] === curImageID.value
      );
    });

    const layerIDs = computed(() => currentLayers.value.map(({ id }) => id));

    const { baseImageRep, labelmapReps, layerReps } = useSceneBuilder<
      vtkResliceRepresentationProxy,
      vtkLabelMapSliceRepProxy,
      vtkIJKSliceRepresentationProxy
    >(viewID, {
      baseImage: curImageID,
      labelmaps: labelmapIDs,
      layers: layerIDs,
    });

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

    // watch([baseImageRep, cameraDirVec], () => {
    watchEffect(() => {
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

    const { restoreCameraConfig } = usePersistCameraConfig(
      viewID,
      curImageID,
      viewProxy,
      'parallelScale',
      'position',
      'focalPoint',
      'viewUp'
    );

    watch(
      [curImageID, cameraDirVec, cameraUpVec],
      () => {
        const cameraConfig = viewCameraStore.getConfig(
          viewID.value,
          curImageID.value
        );

        // If we have a saved camera configuration restore it
        if (cameraConfig) {
          restoreCameraConfig(cameraConfig);

          viewProxy.value.getRenderer().resetCameraClippingRange();
          viewProxy.value.renderLater();

          // Prevent resize
          resizeToFit.value = false;
        } else if (resizeToFit.value) {
          resetCamera();
        } else {
          // this will trigger a resetCamera() call
          resizeToFit.value = true;
        }
      },
      { immediate: true, deep: true }
    );

    // --- viewport orientation/camera labels --- //

    const { top: topLabel, left: leftLabel } = useOrientationLabels(viewProxy);

    watchEffect(() => {
      if (sliceConfig.value == null || wlConfig.value == null) {
        return;
      }

      const { slice, min, max } = sliceConfig.value;
      const { width, level } = wlConfig.value;
      const rep = baseImageRep.value;

      if (rep) {
        rep.setWindowWidth(width);
        rep.setWindowLevel(level);

        const bounds = curImageMetadata.value.worldBounds;
        const sliceNormal = rep?.getSlicePlane().getNormal() as Vector3;
        vtkMath.normalize(sliceNormal);
        const range = [min, max];
        const midRange = 0.5 * (range[0] + range[1]);
        const imc = getCenter(bounds);
        // const sliceDispFromCenter = midRange - slice / (max - min) * (range[1] - range[0]) - range[0];
        const sliceDispFromCenter = slice - midRange;
        const dispVector = vtkMath.multiplyScalar(sliceNormal, sliceDispFromCenter);
        const origin = vtkMath.add(imc, dispVector, [0, 0, 0] as Vector3);
        rep.getSlicePlane().setOrigin(origin);
      }
      [...layerReps.value, ...labelmapReps.value].forEach((lRep) => {
        lRep.setSlice(slice);
      });

      viewProxy.value.renderLater();
    });

    // --- apply labelmap opacity --- //

    watchEffect(() => {
      const { labelmapOpacity } = paintStore;
      labelmapReps.value.forEach((lmRep) => {
        lmRep.setOpacity(labelmapOpacity);
      });
    });

    // --- layers setup --- //

    const layersConfigs = computed(() =>
      layerIDs.value.map((id) => layerColoringStore.getConfig(viewID.value, id))
    );

    const layersStore = useLayersStore();
    watch(
      [viewID, currentLayers],
      () => {
        currentLayers.value.forEach(({ id }, layerIndex) => {
          const image = layersStore.layerImages[id];
          const layerConfig = layersConfigs.value[layerIndex];
          if (image && !layerConfig) {
            layerColoringStore.resetToDefault(viewID.value, id, image);
          }
        });
      },
      { immediate: true }
    );

    // --- layer coloring --- //

    const proxyManager = useProxyManager()!;

    const colorBys = computed(() =>
      layersConfigs.value.map((config) => config?.colorBy)
    );
    const transferFunctions = computed(() =>
      layersConfigs.value.map((config) => config?.transferFunction)
    );
    const opacityFunctions = computed(() =>
      layersConfigs.value.map((config) => config?.opacityFunction)
    );
    const blendConfigs = computed(() =>
      layersConfigs.value.map((config) => config?.blendConfig)
    );

    watch(
      [layerReps, colorBys, transferFunctions, opacityFunctions, blendConfigs],
      () => {
        layerReps.value
          .map(
            (layerRep, idx) =>
              [
                layerRep,
                colorBys.value[idx],
                transferFunctions.value[idx],
                opacityFunctions.value[idx],
                blendConfigs.value[idx],
              ] as const
          )
          .forEach(
            ([
              rep,
              colorBy,
              transferFunction,
              opacityFunction,
              blendConfig,
            ]) => {
              if (
                !colorBy ||
                !transferFunction ||
                !opacityFunction ||
                !blendConfig
              ) {
                return;
              }

              const { arrayName, location } = colorBy;
              const ctFunc = transferFunction;
              const opFunc = opacityFunction;

              const lut = proxyManager.getLookupTable(arrayName);
              lut.setMode(LookupTableProxyMode.Preset);
              lut.setPresetName(ctFunc.preset);
              lut.setDataRange(...ctFunc.mappingRange);

              const pwf = proxyManager.getPiecewiseFunction(arrayName);
              pwf.setMode(opFunc.mode);
              pwf.setDataRange(...opFunc.mappingRange);

              switch (opFunc.mode) {
                case vtkPiecewiseFunctionProxy.Mode.Gaussians:
                  pwf.setGaussians(opFunc.gaussians);
                  break;
                case vtkPiecewiseFunctionProxy.Mode.Points: {
                  const opacityPoints = getShiftedOpacityFromPreset(
                    opFunc.preset,
                    opFunc.mappingRange,
                    opFunc.shift
                  );
                  if (opacityPoints) {
                    pwf.setPoints(opacityPoints);
                  }
                  break;
                }
                case vtkPiecewiseFunctionProxy.Mode.Nodes:
                  pwf.setNodes(opFunc.nodes);
                  break;
                default:
              }

              // control color range manually
              rep.setRescaleOnColorBy(false);
              rep.setColorBy(arrayName, location);
              rep.setOpacity(blendConfig.opacity);

              // Need to trigger a render for when we are restoring from a state file
              viewProxy.value.renderLater();
            }
          );
      },
      { immediate: true, deep: true }
    );

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
      topLabel,
      leftLabel,
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
