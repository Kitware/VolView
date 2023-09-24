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
        <div
          class="vtk-view"
          ref="vtkContainerRef"
          data-testid="vtk-view vtk-two-view"
        />
      </div>
      <div class="overlay-no-events tool-layer" ref="toolContainer">
        <pan-tool :view-id="viewID" />
        <zoom-tool :view-id="viewID" />
        <slice-scroll-tool :view-id="viewID" />
        <window-level-tool :view-id="viewID" />
        <ruler-tool
          :view-id="viewID"
          :widget-manager="widgetManager"
          :view-direction="viewDirection"
          :current-slice="currentSlice"
        />
        <rectangle-tool
          :view-id="viewID"
          :widget-manager="widgetManager"
          :view-direction="viewDirection"
          :current-slice="currentSlice"
        />
        <polygon-tool
          :view-id="viewID"
          :widget-manager="widgetManager"
          :view-direction="viewDirection"
          :current-slice="currentSlice"
        />
        <paint-tool
          :view-id="viewID"
          :view-direction="viewDirection"
          :widget-manager="widgetManager"
          :slice="currentSlice"
        />
        <crosshairs-tool
          :view-id="viewID"
          :view-direction="viewDirection"
          :widget-manager="widgetManager"
          :slice="currentSlice"
        />
        <crop-tool :view-id="viewID" />
      </div>
      <view-overlay-grid class="overlay-no-events view-annotations">
        <template v-slot:top-center>
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
            <div>Slice: {{ currentSlice + 1 }}/{{ sliceMax + 1 }}</div>
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

import { useResizeToFit } from '@/src/composables/useResizeToFit';
import vtkLPSView2DProxy from '@/src/vtk/LPSView2DProxy';
import vtkIJKSliceRepresentationProxy from '@/src/vtk/IJKSliceRepresentationProxy';
import vtkPiecewiseFunctionProxy from '@kitware/vtk.js/Proxy/Core/PiecewiseFunctionProxy';
import { Mode as LookupTableProxyMode } from '@kitware/vtk.js/Proxy/Core/LookupTableProxy';
import { manageVTKSubscription } from '@/src/composables/manageVTKSubscription';
import SliceSlider from '@/src/components/SliceSlider.vue';
import ViewOverlayGrid from '@/src/components/ViewOverlayGrid.vue';
import { useResizeObserver } from '../composables/useResizeObserver';
import { useOrientationLabels } from '../composables/useOrientationLabels';
import { getLPSAxisFromDir } from '../utils/lps';
import { useCurrentImage } from '../composables/useCurrentImage';
import { useCameraOrientation } from '../composables/useCameraOrientation';
import WindowLevelTool from './tools/windowing/WindowLevelTool.vue';
import SliceScrollTool from './tools/SliceScrollTool.vue';
import PanTool from './tools/PanTool.vue';
import ZoomTool from './tools/ZoomTool.vue';
import RulerTool from './tools/ruler/RulerTool.vue';
import RectangleTool from './tools/rectangle/RectangleTool.vue';
import PolygonTool from './tools/polygon/PolygonTool.vue';
import PaintTool from './tools/paint/PaintTool.vue';
import { useSceneBuilder } from '../composables/useSceneBuilder';
import { useDICOMStore } from '../store/datasets-dicom';
import { useLabelmapStore } from '../store/datasets-labelmaps';
import vtkLabelMapSliceRepProxy from '../vtk/LabelMapSliceRepProxy';
import { usePaintToolStore } from '../store/tools/paint';
import useWindowingStore from '../store/view-configs/windowing';
import { usePersistCameraConfig } from '../composables/usePersistCameraConfig';
import CrosshairsTool from './tools/crosshairs/CrosshairsTool.vue';
import { LPSAxisDir } from '../types/lps';
import { ViewProxyType } from '../core/proxies';
import { useViewProxy } from '../composables/useViewProxy';
import { useWidgetManager } from '../composables/useWidgetManager';
import useViewSliceStore, {
  defaultSliceConfig,
} from '../store/view-configs/slicing';
import CropTool from './tools/crop/CropTool.vue';
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
  name: 'VtkTwoView',
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
    RulerTool,
    RectangleTool,
    PolygonTool,
    PaintTool,
    CrosshairsTool,
    CropTool,
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

    const sliceDomain = computed(() => {
      const { lpsOrientation, dimensions } = curImageMetadata.value;
      const ijkIndex = lpsOrientation[viewAxis.value];
      const dimMax = dimensions[ijkIndex];

      return {
        min: 0,
        max: dimMax - 1,
      };
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
      useViewProxy<vtkLPSView2DProxy>(viewID, ViewProxyType.Slice);

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

    // --- Slicing setup --- //

    watchEffect(() => {
      const ijkIndex = curImageMetadata.value.lpsOrientation[viewAxis.value];
      viewProxy.value.setSlicingMode('IJK'[ijkIndex]);
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
      vtkIJKSliceRepresentationProxy,
      vtkLabelMapSliceRepProxy,
      vtkIJKSliceRepresentationProxy
    >(viewID, {
      baseImage: curImageID,
      labelmaps: labelmapIDs,
      layers: layerIDs,
    });

    // --- camera setup --- //

    const { cameraDirVec, cameraUpVec } = useCameraOrientation(
      viewDirection,
      viewUp,
      curImageMetadata
    );
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

    // --- apply windowing and slice configs --- //

    watchEffect(() => {
      if (sliceConfig.value == null || wlConfig.value == null) {
        return;
      }

      const { slice } = sliceConfig.value;
      const { width, level } = wlConfig.value;
      const rep = baseImageRep.value;
      if (rep) {
        rep.setSlice(slice);
        rep.setWindowWidth(width);
        rep.setWindowLevel(level);
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
