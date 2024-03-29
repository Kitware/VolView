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
        v-model="currentSlice"
        class="slice-slider"
        :min="sliceRange[0]"
        :max="sliceRange[1]"
        :step="1"
        :handle-height="20"
      />
    </div>
    <div
      class="vtk-container"
      :class="active ? 'active' : ''"
      data-testid="two-view-container"
    >
      <div class="vtk-sub-container">
        <div
          class="vtk-view"
          ref="vtkContainerRef"
          data-testid="vtk-view vtk-two-view"
        />
      </div>
      <div class="overlay-no-events tool-layer" ref="toolContainer">
        <svg class="overlay-no-events">
          <bounding-rectangle :points="selectionPoints" :view-id="viewID" />
        </svg>
        <pan-tool :view-id="viewID" />
        <zoom-tool :view-id="viewID" />
        <slice-scroll-tool :view-id="viewID" />
        <window-level-tool :view-id="viewID" />
        <select-tool :view-id="viewID" />
        <ruler-tool
          :view-id="viewID"
          :view-direction="viewDirection"
          :current-slice="currentSlice"
        />
        <rectangle-tool
          :view-id="viewID"
          :view-direction="viewDirection"
          :current-slice="currentSlice"
        />
        <polygon-tool
          :view-id="viewID"
          :view-direction="viewDirection"
          :current-slice="currentSlice"
        />
        <paint-tool
          :view-id="viewID"
          :view-direction="viewDirection"
          :slice="currentSlice"
        />
        <crosshairs-tool
          :view-id="viewID"
          :view-direction="viewDirection"
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
            <div>Slice: {{ currentSlice + 1 }}/{{ sliceRange[1] + 1 }}</div>
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
            <dicom-quick-info-button
              :image-id="curImageID"
            ></dicom-quick-info-button>
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
import { manageVTKSubscription } from '@/src/composables/manageVTKSubscription';
import SliceSlider from '@/src/components/SliceSlider.vue';
import ViewOverlayGrid from '@/src/components/ViewOverlayGrid.vue';
import SelectTool from '@/src/components/tools/SelectTool.vue';
import BoundingRectangle from '@/src/components/tools/BoundingRectangle.vue';
import { useToolSelectionStore } from '@/src/store/tools/toolSelection';
import { useAnnotationToolStore } from '@/src/store/tools';
import { doesToolFrameMatchViewAxis } from '@/src/composables/annotationTool';
import { useSliceConfig } from '@/src/composables/useSliceConfig';
import { useSliceConfigInitializer } from '@/src/composables/useSliceConfigInitializer';
import { useWindowingConfig } from '@/src/composables/useWindowingConfig';
import { useWindowingConfigInitializer } from '@/src/composables/useWindowingConfigInitializer';
import { useBaseSliceRepresentation } from '@/src/composables/useBaseSliceRepresentation';
import { useLabelMapRepresentations } from '@/src/composables/useLabelMapRepresentations';
import { useLayerRepresentations } from '@/src/composables/useLayerRepresentations';
import DicomQuickInfoButton from '@/src/components/DicomQuickInfoButton.vue';
import { applyColoring } from '@/src/composables/useColoringEffect';
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
import { useSegmentGroupStore } from '../store/segmentGroups';
import { usePaintToolStore } from '../store/tools/paint';
import { usePersistCameraConfig } from '../composables/usePersistCameraConfig';
import CrosshairsTool from './tools/crosshairs/CrosshairsTool.vue';
import { LPSAxisDir } from '../types/lps';
import { ViewProxyType } from '../core/proxies';
import { useViewProxy } from '../composables/useViewProxy';
import useViewSliceStore from '../store/view-configs/slicing';
import CropTool from './tools/crop/CropTool.vue';
import { ToolContainer } from '../constants';
import { useProxyManager } from '../composables/useProxyManager';
import { useLayersStore } from '../store/datasets-layers';
import { useViewCameraStore } from '../store/view-configs/camera';
import useLayerColoringStore from '../store/view-configs/layers';
import { useResetViewsEvents } from './tools/ResetViews.vue';

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
    BoundingRectangle,
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
    SelectTool,
    DicomQuickInfoButton,
  },
  setup(props) {
    const viewSliceStore = useViewSliceStore();
    const viewCameraStore = useViewCameraStore();
    const layerColoringStore = useLayerColoringStore();
    const paintStore = usePaintToolStore();

    const { id: viewID, viewDirection, viewUp } = toRefs(props);

    const vtkContainerRef = ref<HTMLElement>();

    const viewAxis = computed(() => getLPSAxisFromDir(viewDirection.value));

    // --- computed vars --- //

    const {
      currentImageID: curImageID,
      currentImageMetadata: curImageMetadata,
      isImageLoading,
      currentLayers,
    } = useCurrentImage();

    const {
      config: sliceConfig,
      slice: currentSlice,
      range: sliceRange,
    } = useSliceConfig(viewID, curImageID);
    const {
      config: wlConfig,
      width: windowWidth,
      level: windowLevel,
    } = useWindowingConfig(viewID, curImageID);

    // --- initializers --- //

    const sliceDomain = computed(() => {
      const { lpsOrientation, dimensions } = curImageMetadata.value;
      const ijkIndex = lpsOrientation[viewAxis.value];
      const dimMax = dimensions[ijkIndex];

      return {
        min: 0,
        max: dimMax - 1,
      };
    });

    useSliceConfigInitializer(viewID, curImageID, viewDirection, sliceDomain);
    useWindowingConfigInitializer(viewID, curImageID);

    // --- view proxy setup --- //

    const { viewProxy } = useViewProxy<vtkLPSView2DProxy>(
      viewID,
      ViewProxyType.Slice
    );

    onBeforeMount(() => {
      // do this before mount, as the ManipulatorTools run onMounted
      // before this component does.
      viewProxy.value.getInteractorStyle2D().removeAllManipulators();
    });

    onMounted(() => {
      viewProxy.value.setContainer(vtkContainerRef.value ?? null);
      viewProxy.value.setOrientationAxesVisibility(false);
    });

    onBeforeUnmount(() => {
      viewProxy.value.setContainer(null);
    });

    // --- Slicing setup --- //

    watchEffect(() => {
      const ijkIndex = curImageMetadata.value.lpsOrientation[viewAxis.value];
      viewProxy.value.setSlicingMode('IJK'[ijkIndex]);
    });

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

    // --- scene setup --- //

    const segmentGroupStore = useSegmentGroupStore();

    const segmentGroupIDs = computed(() =>
      curImageID.value ? segmentGroupStore.orderByParent[curImageID.value] : []
    );

    const layerIDs = computed(() => currentLayers.value.map(({ id }) => id));

    const { representation: baseImageRep } =
      useBaseSliceRepresentation<vtkIJKSliceRepresentationProxy>(
        curImageID,
        viewID
      );

    const { representations: labelmapReps } = useLabelMapRepresentations(
      segmentGroupIDs,
      viewID
    );

    const { representations: layerReps } =
      useLayerRepresentations<vtkIJKSliceRepresentationProxy>(layerIDs, viewID);

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
      ([view, layers]) => {
        layers.forEach(({ id }) => {
          const image = layersStore.layerImages[id];
          layerColoringStore.updateColorBy(view, id, {
            arrayName: image.getPointData().getScalars().getName() + id,
            location: 'pointData',
          });
          const layerConfig = layerColoringStore.getConfig(view, id);
          if (!layerConfig!.transferFunction.preset) {
            layerColoringStore.resetColorPreset(view, id);
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

    watchEffect(() => {
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
          ([rep, colorBy, transferFunction, opacityFunction, blendConfig]) => {
            if (
              !colorBy ||
              !transferFunction ||
              !opacityFunction ||
              !blendConfig
            ) {
              return;
            }

            applyColoring({
              colorBy,
              colorFunc: transferFunction,
              opacityFunc: opacityFunction,
              rep,
              proxyManager,
            });

            rep.setOpacity(blendConfig.opacity);

            // Need to trigger a render for when we are restoring from a state file
            viewProxy.value.renderLater();
          }
        );
    });

    // --- selection points --- //

    const selectionStore = useToolSelectionStore();
    const selectionPoints = computed(() => {
      return selectionStore.selection
        .map((sel) => {
          const store = useAnnotationToolStore(sel.type);
          return { store, tool: store.toolByID[sel.id] };
        })
        .filter(
          ({ tool }) =>
            tool.slice === currentSlice.value &&
            doesToolFrameMatchViewAxis(viewAxis, tool, curImageMetadata)
        )
        .flatMap(({ store, tool }) => store.getPoints(tool.id));
    });

    // --- //

    // Listen to ResetViews event.
    const events = useResetViewsEvents();
    events.onClick(() => resetCamera());

    return {
      vtkContainerRef,
      toolContainer,
      viewID,
      viewProxy,
      viewAxis,
      active: true,
      curImageID,
      currentSlice,
      sliceRange,
      windowWidth,
      windowLevel,
      topLabel,
      leftLabel,
      isImageLoading,
      enableResizeToFit() {
        resizeToFit.value = true;
      },
      hover,
      selectionPoints,
    };
  },
});
</script>

<style scoped src="@/src/components/styles/vtk-view.css"></style>
<style scoped src="@/src/components/styles/utils.css"></style>
