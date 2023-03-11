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
      <v-tooltip right transition="slide-x-transition">
        <template v-slot:activator="{ on, attrs }">
          <v-btn
            dark
            x-small
            icon
            @click="enableResizeToFit"
            v-bind="attrs"
            v-on="on"
          >
            <v-icon small class="py-1">mdi-camera-flip-outline</v-icon>
          </v-btn>
        </template>
        <span>Reset camera</span>
      </v-tooltip>
      <slice-slider
        class="slice-slider"
        :slice="slice"
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
      <div class="overlay-no-events tool-layer">
        <pan-tool :view-id="viewID" />
        <zoom-tool :view-id="viewID" />
        <slice-scroll-tool :view-id="viewID" />
        <window-level-tool :view-id="viewID" />
        <ruler-tool
          view-type="2D"
          :view-id="viewID"
          :widget-manager="widgetManager"
          :view-direction="viewDirection"
          :slice="slice"
        />
        <paint-tool
          :view-id="viewID"
          :view-direction="viewDirection"
          :widget-manager="widgetManager"
          :slice="slice"
        />
        <crosshairs-tool
          :view-id="viewID"
          :view-direction="viewDirection"
          :widget-manager="widgetManager"
          :slice="slice"
        />
        <crop-tool :view-id="viewID" />
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
            <div>Slice: {{ slice + 1 }}/{{ sliceMax + 1 }}</div>
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
              offset-y
              left
              nudge-left="10"
              dark
              v-if="dicomInfo !== null"
              max-width="300px"
            >
              <template v-slot:activator="{ on, attrs }">
                <v-btn
                  dark
                  small
                  icon
                  v-bind="attrs"
                  v-on="on"
                  class="pointer-events-all"
                >
                  <v-icon dark> mdi-information </v-icon>
                </v-btn>
              </template>
              <v-list class="grey darken-3">
                <v-list-item>
                  <v-list-item-content>
                    <v-list-item-title class="font-weight-bold">
                      PATIENT / CASE
                    </v-list-item-title>
                    <v-divider />
                    <v-list-item-title>
                      ID: {{ dicomInfo.patientID }}
                    </v-list-item-title>
                  </v-list-item-content>
                </v-list-item>
                <v-list-item>
                  <v-list-item-content>
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
                  </v-list-item-content>
                </v-list-item>
                <v-list-item>
                  <v-list-item-content>
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
                  </v-list-item-content>
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
} from '@vue/composition-api';
import { vec3 } from 'gl-matrix';
import { onKeyStroke } from '@vueuse/core';

import { useResizeToFit } from '@src/composables/useResizeToFit';
import vtkLPSView2DProxy from '@src/vtk/LPSView2DProxy';
import vtkIJKSliceRepresentationProxy from '@src/vtk/IJKSliceRepresentationProxy';
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
import RulerTool from './tools/RulerTool.vue';
import PaintTool from './tools/PaintTool.vue';
import { useSceneBuilder } from '../composables/useSceneBuilder';
import { useDICOMStore } from '../store/datasets-dicom';
import { useLabelmapStore } from '../store/datasets-labelmaps';
import vtkLabelMapSliceRepProxy from '../vtk/LabelMapSliceRepProxy';
import { usePaintToolStore } from '../store/tools/paint';
import { useViewConfigStore } from '../store/view-configs';
import { usePersistCameraConfig } from '../composables/usePersistCameraConfig';
import CrosshairsTool from './tools/CrosshairsTool.vue';
import { LPSAxisDir } from '../types/lps';
import { ViewProxyType } from '../core/proxies';
import { useViewProxy } from '../composables/useViewProxy';
import { useWidgetManager } from '../composables/useWidgetManager';
import { CameraConfig } from '../store/view-configs/types';
import { defaultSliceConfig } from '../store/view-configs/slicing';
import { useWindowingSync } from '../composables/sync/useWindowingSync';
import CropTool from './tools/CropTool.vue';
import { VTKTwoViewWidgetManager } from '../constants';
import { useProxyManager } from '../composables/proxyManager';
import { getShiftedOpacityFromPreset } from '../utils/vtk-helpers';
import { useLayersStore } from '../store/datasets-layers';

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
    PaintTool,
    CrosshairsTool,
    CropTool,
  },
  setup(props) {
    const viewConfigStore = useViewConfigStore();
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
      curImageID.value !== null
        ? viewConfigStore.getSliceConfig(viewID.value, curImageID.value)!
        : null
    );
    const currentSlice = computed(() =>
      sliceConfig.value !== null
        ? sliceConfig.value.slice
        : sliceConfigDefaults.slice
    );
    const sliceMin = computed(() =>
      sliceConfig.value !== null
        ? sliceConfig.value.min
        : sliceConfigDefaults.min
    );
    const sliceMax = computed(() =>
      sliceConfig.value !== null
        ? sliceConfig.value.max
        : sliceConfigDefaults.max
    );

    const wlConfig = computed({
      get: () => {
        const _viewID = viewID.value;
        const imageID = curImageID.value;
        if (imageID !== null) {
          return viewConfigStore.getWindowingConfig(_viewID, imageID) ?? null;
        }
        return null;
      },
      set: (newValue) => {
        const imageID = curImageID.value;
        if (imageID !== null && newValue != null) {
          viewConfigStore.updateWindowingConfig(
            viewID.value,
            imageID,
            newValue
          );
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
        viewConfigStore.updateSliceConfig(viewID.value, curImageID.value, {
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
      () => {
        if (
          curImageID.value &&
          !viewConfigStore.getSliceConfig(viewID.value, curImageID.value)
        ) {
          viewConfigStore.updateSliceConfig(viewID.value, curImageID.value, {
            ...sliceDomain.value,
            axisDirection: viewDirection.value,
          });
          viewConfigStore.resetSlice(viewID.value, curImageID.value);
        }
      },
      { immediate: true, deep: true }
    );

    // --- arrows change slice --- //

    const hover = ref(false);
    const onKeyDown = (event: KeyboardEvent) => {
      if (!curImageID.value || !hover.value) return;

      const sliceOffset = SLICE_OFFSET_KEYS[event.key] ?? 0;
      if (sliceOffset) {
        viewConfigStore.updateSliceConfig(viewID.value, curImageID.value, {
          slice: currentSlice.value + sliceOffset,
        });

        event.stopPropagation();
      }
    };
    onKeyStroke(Object.keys(SLICE_OFFSET_KEYS), onKeyDown);

    // --- resizing --- //

    useResizeObserver(vtkContainerRef, () => viewProxy.value.resize());

    // --- widget manager --- //

    const { widgetManager } = useWidgetManager(viewProxy);
    provide(VTKTwoViewWidgetManager, widgetManager);

    // --- window/level setup --- //

    watch(
      curImageData,
      (imageData, oldImageData) => {
        if (imageData && imageData !== oldImageData) {
          // TODO listen to changes in point data
          const range = imageData.getPointData().getScalars().getRange();
          if (
            curImageID.value !== null &&
            !viewConfigStore.getWindowingConfig(viewID.value, curImageID.value)
          ) {
            viewConfigStore.updateWindowingConfig(
              viewID.value,
              curImageID.value,
              {
                min: range[0],
                max: range[1],
              }
            );
            viewConfigStore.resetWindowLevel(viewID.value, curImageID.value);
          }
        }
      },
      {
        immediate: true,
      }
    );

    // --- sync windowing parameters --- //

    useWindowingSync(curImageID, wlConfig);

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

      viewProxy.value.render();
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
        let cameraConfig: CameraConfig | undefined;
        if (curImageID.value !== null) {
          cameraConfig = viewConfigStore.getCameraConfig(
            viewID.value,
            curImageID.value
          );
        }

        // If we have a saved camera configuration restore it
        if (cameraConfig) {
          restoreCameraConfig(cameraConfig);

          viewProxy.value.getRenderer().resetCameraClippingRange();
          viewProxy.value.render();

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
      if (sliceConfig.value === null || wlConfig.value === null) {
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

      viewProxy.value.render();
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
      layerIDs.value.map((id) =>
        viewConfigStore.layers.getComputedConfig(viewID, id)
      )
    );

    const layersStore = useLayersStore();
    watch(
      [viewID, currentLayers],
      () => {
        currentLayers.value.forEach(({ id }, layerIndex) => {
          const image = layersStore.layerImages[id];
          const layerConfig = layersConfigs.value[layerIndex].value;
          if (image && !layerConfig) {
            viewConfigStore.layers.resetToDefault(viewID.value, id, image);
          }
        });
      },
      { immediate: true }
    );

    // --- layer coloring --- //

    const proxyManager = useProxyManager()!;

    const colorBys = computed(() =>
      layersConfigs.value.map((config) => config.value?.colorBy)
    );
    const transferFunctions = computed(() =>
      layersConfigs.value.map((config) => config.value?.transferFunction)
    );
    const opacityFunctions = computed(() =>
      layersConfigs.value.map((config) => config.value?.opacityFunction)
    );
    const blendConfigs = computed(() =>
      layersConfigs.value.map((config) => config.value?.blendConfig)
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

              rep.setColorBy(arrayName, location);
              rep.setOpacity(blendConfig.opacity);

              // Need to trigger a render for when we are restoring from a state file
              viewProxy.value.render();
            }
          );
      },
      { immediate: true, deep: true }
    );

    return {
      vtkContainerRef,
      viewID,
      viewProxy,
      viewAxis,
      active: true,
      slice: currentSlice,
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
