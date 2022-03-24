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

import vtkSourceProxy from '@kitware/vtk.js/Proxy/Core/SourceProxy';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

import { useIDStore } from '@src/storex/id';
import { useView2DStore } from '@src/storex/views-2D';
import { useVTKProxyStore } from '@src/storex/vtk-proxy';
import { useProxyManager } from '@/src/composables/proxyManager';
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
  },
  setup(props) {
    const idStore = useIDStore();
    const view2DStore = useView2DStore();
    const proxyStore = useVTKProxyStore();
    const proxyManager = useProxyManager()!;

    const { viewDirection, viewUp } = toRefs(props);

    const vtkContainerRef = ref<HTMLElement>();
    const currentImageRepRef = ref<vtkIJKSliceRepresentationProxy | null>();

    const viewAxis = computed(() => getLPSAxisFromDir(viewDirection.value));

    // --- view store --- //

    const viewID = idStore.getNextID();

    view2DStore.addView(viewID, viewAxis.value);
    onBeforeUnmount(() => {
      view2DStore.removeView(viewID);
    });

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

    const viewType = `${viewAxis.value}View`;
    // axis is set via proxy configs
    const viewProxy = proxyManager.createProxy<vtkLPSView2DProxy>(
      'Views',
      viewType,
      {
        name: viewAxis.value,
      }
    );

    proxyStore.addView(viewID, viewProxy.getProxyId());

    // do this before mounting
    viewProxy.getInteractorStyle2D().removeAllManipulators();

    onMounted(() => {
      viewProxy.setOrientationAxesVisibility(false);
      viewProxy.setContainer(vtkContainerRef.value ?? null);
    });

    onBeforeUnmount(() => {
      viewProxy.setContainer(null);
      proxyStore.removeView(viewID);
      proxyManager.deleteProxy(viewProxy);
    });

    // updates slicing mode based on the IJK index
    watchEffect(() => {
      const ijkIndex = curImageMetadata.value.lpsOrientation[viewAxis.value];
      viewProxy.setSlicingMode('IJK'[ijkIndex]);
    });

    useResizeObserver(vtkContainerRef, () => viewProxy.resize());

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

    watchEffect(() => {
      const { dataToProxyID } = proxyStore;

      viewProxy.removeAllRepresentations();
      // Nullify image representation ref.
      // Helps re-trigger setting of the slice and W/L properties by
      // forcing a trigger of the corresponding watchEffect below.
      // addRepresentation(rep) triggers the SliceRepresentationProxy to
      // reset slicing and W/L to its own defaults, and we need to override
      // that to use our own values.
      currentImageRepRef.value = null;

      // update the current image
      if (curImageID.value && curImageID.value in dataToProxyID) {
        const proxyID = dataToProxyID[curImageID.value];
        const sourceProxy = proxyManager.getProxyById<
          vtkSourceProxy<vtkImageData>
        >(proxyID);
        if (sourceProxy) {
          const rep = proxyManager.getRepresentation<vtkIJKSliceRepresentationProxy>(
            sourceProxy,
            viewProxy
          );
          if (rep) {
            viewProxy.addRepresentation(rep);
            currentImageRepRef.value = rep;
          }
        }
      }

      // TODO not sure why I need this, but might as well keep
      // the renderer up to date.
      // For reference, this doesn't get invoked when resetting the
      // camera with a supplied bounds, so we manually invoke it here.
      viewProxy.getRenderer().computeVisiblePropBounds();
    });

    // --- camera setup --- //

    const { cameraDirVec, cameraUpVec } = useCameraOrientation(
      viewDirection,
      viewUp,
      curImageMetadata
    );
    const {
      resizeToFit,
      ignoreResizeToFitTracking,
      resetResizeToFitTracking,
    } = useResizeToFit(viewProxy.getCamera(), false);

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
      [currentImageRepRef, cameraDirVec, cameraUpVec],
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
      const rep = currentImageRepRef.value;
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
    };
  },
});
</script>

<style scoped src="@/src/assets/styles/vtk-view.css"></style>
