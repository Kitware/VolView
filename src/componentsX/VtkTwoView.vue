<template>
  <div class="vtk-container-wrapper">
    <div class="vtk-gutter">
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
      <div class="overlay tool-layer">
        <pan-tool :view-proxy="viewProxy" />
        <zoom-tool :view-proxy="viewProxy" />
        <slice-scroll-tool :view-id="viewID" :view-proxy="viewProxy" />
        <window-level-tool :view-id="viewID" :view-proxy="viewProxy" />
        <ruler-tool
          view-type="2D"
          :view-id="viewID"
          :widget-manager="widgetManager"
          :view-direction="viewDirection"
          :view-proxy="viewProxy"
        />
      </div>
      <view-overlay-grid class="overlay view-annotations">
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
            <div>
              W/L: {{ windowWidth.toFixed(2) }} / {{ windowLevel.toFixed(2) }}
            </div>
          </div>
        </template>
      </view-overlay-grid>
      <transition name="loading">
        <div v-if="isImageLoading" class="overlay loading">
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
  onBeforeUnmount,
  onMounted,
  PropType,
  ref,
  toRefs,
  watch,
  watchEffect,
} from '@vue/composition-api';
import { vec3 } from 'gl-matrix';

import vtkWidgetManager from '@kitware/vtk.js/Widgets/Core/WidgetManager';

import { useView2DStore } from '@/src/store/views-2D';
import { useResizeToFit } from '@src/composables/useResizeToFit';
import vtkLPSView2DProxy from '@src/vtk/LPSView2DProxy';
import vtkIJKSliceRepresentationProxy from '@src/vtk/IJKSliceRepresentationProxy';
import { manageVTKSubscription } from '@src/composables/manageVTKSubscription';
import SliceSlider from '@src/components/SliceSlider.vue';
import ViewOverlayGrid from '@src/componentsX/ViewOverlayGrid.vue';
import { useResizeObserver } from '../composables/useResizeObserver';
import { useOrientationLabels } from '../composables/useOrientationLabels';
import { getLPSAxisFromDir, LPSAxisDir } from '../utils/lps';
import { useCurrentImage } from '../composables/useCurrentImage';
import { useCameraOrientation } from '../composables/useCameraOrientation';
import WindowLevelTool from '../components/tools/WindowLevelTool.vue';
import SliceScrollTool from '../components/tools/SliceScrollTool.vue';
import PanTool from '../components/tools/PanTool.vue';
import ZoomTool from '../components/tools/ZoomTool.vue';
import RulerTool from '../components/tools/RulerTool.vue';
import { useSceneBuilder } from '../composables/useSceneBuilder';

export default defineComponent({
  name: 'VtkTwoView',
  props: {
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
  },
  setup(props) {
    const view2DStore = useView2DStore();

    const { viewDirection, viewUp } = toRefs(props);

    const vtkContainerRef = ref<HTMLElement>();

    const viewAxis = computed(() => getLPSAxisFromDir(viewDirection.value));

    // --- view creation --- //

    // TODO changing the viewDirection prop is not supported at this time.
    const { id: viewID, proxy: viewProxy } =
      view2DStore.createView<vtkLPSView2DProxy>(viewDirection.value);

    // --- computed vars --- //

    const {
      currentImageData: curImageData,
      currentImageID: curImageID,
      currentImageMetadata: curImageMetadata,
      isImageLoading,
    } = useCurrentImage();

    const sliceConfig = computed(() => view2DStore.sliceConfigs[viewID]);
    const currentSlice = computed(() => sliceConfig.value.slice);
    const sliceMin = computed(() => sliceConfig.value.min);
    const sliceMax = computed(() => sliceConfig.value.max);

    const wlConfig = computed(() => view2DStore.wlConfigs[viewID]);
    const windowWidth = computed(() => wlConfig.value.width);
    const windowLevel = computed(() => wlConfig.value.level);

    // --- view proxy setup --- //

    onBeforeUnmount(() => {
      view2DStore.removeView(viewID);
    });

    // do this before mounting
    viewProxy.getInteractorStyle2D().removeAllManipulators();

    onMounted(() => {
      viewProxy.setOrientationAxesVisibility(false);
      viewProxy.setContainer(vtkContainerRef.value ?? null);
    });

    onBeforeUnmount(() => {
      viewProxy.setContainer(null);
    });

    // updates slicing mode based on the IJK index
    watchEffect(() => {
      const ijkIndex = curImageMetadata.value.lpsOrientation[viewAxis.value];
      viewProxy.setSlicingMode('IJK'[ijkIndex]);
    });

    useResizeObserver(vtkContainerRef, () => viewProxy.resize());

    // --- widget manager --- //

    const widgetManager = vtkWidgetManager.newInstance({
      useSvgLayer: false,
    });
    widgetManager.setRenderer(viewProxy.getRenderer());

    // --- resetting slice properties --- //

    watch(
      curImageData,
      (imageData, oldImageData) => {
        // FIXME the old check is to workaround a vue bug/quirk where
        // the curImageData dependencies trigger, but the ref value is
        // equivalent, yet this watcher still runs.
        if (imageData && imageData !== oldImageData) {
          const { lpsOrientation, dimensions } = curImageMetadata.value;
          const ijkIndex = lpsOrientation[viewAxis.value];
          const dimMax = dimensions[ijkIndex];

          // update dimensions
          // dimMax is upper bound of slices, exclusive.
          view2DStore.updateSliceDomain(viewID, [0, dimMax - 1]);
          // move slice to center when image metadata changes.
          // TODO what if new slices are added to the same image?
          //      do we still reset the slicing?
          view2DStore.setSlice(viewID, Math.floor((dimMax - 1) / 2));
        }
      },

      // we don't use watchEffect, since I think
      // accessing the actions on view2DStore cause it
      // to trigger when any view2DStore state is modified.
      { immediate: true }
    );

    // --- window/level setup --- //

    watch(
      curImageData,
      (imageData, oldImageData) => {
        if (imageData && imageData !== oldImageData) {
          // TODO listen to changes in point data
          const range = imageData.getPointData().getScalars().getRange();
          view2DStore.updateWLDomain(viewID, range);
          view2DStore.resetWindowLevel(viewID);
        }
      },
      {
        immediate: true,
      }
    );

    // --- scene setup --- //

    const { baseImageRep } = useSceneBuilder<vtkIJKSliceRepresentationProxy>(
      viewID,
      {
        baseImage: curImageID,
      }
    );

    // --- camera setup --- //

    const { cameraDirVec, cameraUpVec } = useCameraOrientation(
      viewDirection,
      viewUp,
      curImageMetadata
    );
    const { resizeToFit, ignoreResizeToFitTracking, resetResizeToFitTracking } =
      useResizeToFit(viewProxy.getCamera(), false);

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
        viewProxy.resizeToFit(lookAxis, upAxis, dimsWithSpacing);
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
        viewProxy.updateCamera(cameraDirVec.value, cameraUpVec.value, center);
        viewProxy.resetCamera(bounds);
      });

      resizeToFitScene();

      viewProxy.render();
    };

    manageVTKSubscription(
      viewProxy.onResize(() => {
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
      [baseImageRep, cameraDirVec, cameraUpVec],
      () => {
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

    const { top: topLabel, left: leftLabel } = useOrientationLabels(viewProxy);

    // --- apply windowing and slice configs --- //

    watchEffect(() => {
      const { slice } = sliceConfig.value;
      const { width, level } = wlConfig.value;
      const rep = baseImageRep.value;
      if (rep) {
        rep.setSlice(slice);
        rep.setWindowWidth(width);
        rep.setWindowLevel(level);
      }
    });

    // --- template vars --- //

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
      setSlice: (slice: number) => view2DStore.setSlice(viewID, slice),
      widgetManager,
    };
  },
});
</script>

<style scoped src="@/src/assets/styles/vtk-view.css"></style>
