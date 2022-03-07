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
      <div class="overlay">
        <view-overlay-grid>
          <template v-slot:bottom-left>
            <div class="overlay-cell">
              <div>Slice: {{ slice + 1 }}/{{ sliceMax + 1 }}</div>
              <div>
                W/L: {{ windowWidth.toFixed(2) }} / {{ windowLevel.toFixed(2) }}
              </div>
            </div>
          </template>
        </view-overlay-grid>
      </div>
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
import { mat3, vec3 } from 'gl-matrix';

import vtkSourceProxy from '@kitware/vtk.js/Proxy/Core/SourceProxy';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

import { useIDStore } from '@src/storex/id';
import {
  defaultImageMetadata,
  useImageStore,
} from '@src/storex/datasets-images';
import { useView2DStore } from '@src/storex/views-2D';
import { useViewStore } from '@src/storex/views';
import { useVTKProxyStore } from '@src/storex/vtk-proxy';
import { useProxyManager } from '@/src/composables/proxyManager';
import { use2DMouseControls } from '@src/composables/use2DMouseControls';
import { useResizeToFit } from '@src/composables/useResizeToFit';
import vtkLPSView2DProxy from '@src/vtk/LPSView2DProxy';
import vtkIJKSliceRepresentationProxy from '@src/vtk/IJKSliceRepresentationProxy';
import { manageVTKSubscription } from '@src/composables/manageVTKSubscription';

import SliceSlider from '@src/components/SliceSlider.vue';
import ViewOverlayGrid from '@src/componentsX/ViewOverlayGrid.vue';
import { useResizeObserver } from '../composables/useResizeObserver';
import { getLPSAxisFromDir, getLPSDirections, LPSAxisDir } from '../utils/lps';

function computeStep(min: number, max: number) {
  return Math.min(max - min, 1) / 256;
}

export default defineComponent({
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
  },
  setup(props) {
    const idStore = useIDStore();
    const viewStore = useViewStore();
    const view2DStore = useView2DStore();
    const imageStore = useImageStore();
    const proxyStore = useVTKProxyStore();
    const proxyManager = useProxyManager()!;

    const { viewDirection, viewUp } = toRefs(props);

    const vtkContainerRef = ref<HTMLElement>();
    const currentImageRepRef = ref<vtkIJKSliceRepresentationProxy>();

    const viewAxis = computed(() => getLPSAxisFromDir(viewDirection.value));

    // --- view store --- //

    const viewID = idStore.getNextID();

    view2DStore.addView(viewID, viewAxis.value);
    onBeforeUnmount(() => {
      view2DStore.removeView(viewID);
    });

    // --- computed vars --- //

    const curImageMetadata = computed(() => {
      const { metadata } = imageStore;
      if (viewStore.currentImageID) {
        return metadata[viewStore.currentImageID];
      }
      return defaultImageMetadata();
    });

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

    onMounted(() => {
      viewProxy.setOrientationAxesVisibility(false);
      viewProxy.setContainer(vtkContainerRef.value ?? null);
    });

    onBeforeUnmount(() => {
      viewProxy.setContainer(null);
      proxyManager.deleteProxy(viewProxy);
    });

    // updates slicing mode based on the IJK index
    watchEffect(() => {
      const ijkIndex = curImageMetadata.value.lpsOrientation[viewAxis.value];
      viewProxy.setSlicingMode('IJK'[ijkIndex]);
    });

    useResizeObserver(vtkContainerRef, () => viewProxy.resize());

    // --- slice setup --- //

    watch(
      () => {
        const ijkIndex = curImageMetadata.value.lpsOrientation[viewAxis.value];
        return curImageMetadata.value.dimensions[ijkIndex];
      },
      (dimMax) => {
        // dimMax is upper bound of slices, exclusive.
        view2DStore.updateSliceDomain(viewID, [0, dimMax - 1]);
        // move slice to center when image metadata changes.
        // TODO what if new slices are added to the same image?
        //      do we still reset the slicing?
        view2DStore.setSlice(viewID, Math.floor((dimMax - 1) / 2));
      },
      {
        // we don't use watchEffect, since I think
        // accessing the actions on view2DStore cause it
        // to trigger when any view2DStore state is modified.
        immediate: true,
      }
    );

    // --- window/level setup --- //

    watch(
      () => viewStore.currentImageID,
      (imageID) => {
        if (imageID) {
          const imageData = imageStore.dataIndex[imageID] as vtkImageData;
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
      const curImageID = viewStore.currentImageID;
      const { dataToProxyID } = proxyStore;

      viewProxy.removeAllRepresentations();

      // update the current image
      if (curImageID && curImageID in dataToProxyID) {
        const proxyID = dataToProxyID[curImageID];
        const sourceProxy = proxyManager.getProxyById<
          vtkSourceProxy<vtkImageData>
        >(proxyID);
        if (sourceProxy) {
          const rep = proxyManager.getRepresentation<vtkIJKSliceRepresentationProxy>(
            sourceProxy,
            viewProxy
          );
          if (rep) {
            currentImageRepRef.value = rep;
            viewProxy.addRepresentation(rep);
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

    const orientationMatrix = computed(
      () => curImageMetadata.value.orientation as mat3
    );
    const lpsDirections = computed(() =>
      getLPSDirections(orientationMatrix.value)
    );
    const cameraDirVec = computed(
      () => lpsDirections.value[viewDirection.value]
    );
    const cameraUpVec = computed(() => lpsDirections.value[viewUp.value]);
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
      [curImageMetadata, cameraDirVec, cameraUpVec, lpsDirections],
      () => {
        if (resizeToFit.value) {
          resetCamera();
        } else {
          // this will trigger a resetCamera() call
          resizeToFit.value = true;
        }
      },
      { immediate: true }
    );

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

    // --- mouse controls --- //

    const wwRange = computed(() => ({
      min: 0,
      max: wlConfig.value.max - wlConfig.value.min,
      step: computeStep(wlConfig.value.min, wlConfig.value.max),
      default: wlConfig.value.width,
    }));
    const wlRange = computed(() => ({
      min: wlConfig.value.min,
      max: wlConfig.value.max,
      step: computeStep(wlConfig.value.min, wlConfig.value.max),
      default: wlConfig.value.level,
    }));
    const sliceRange = computed(() => ({
      min: sliceConfig.value.min,
      max: sliceConfig.value.max,
      step: 1,
      default: sliceConfig.value.slice,
    }));
    const mouseValues = use2DMouseControls(
      viewProxy,
      wwRange,
      wlRange,
      sliceRange,
      [
        { type: 'pan', options: { shift: true } },
        { type: 'zoom', options: { control: true } },
      ]
    );

    watch(mouseValues.vertVal, (ww) =>
      view2DStore.setWindowLevel(viewID, { width: ww })
    );
    watch(mouseValues.horizVal, (wl) =>
      view2DStore.setWindowLevel(viewID, { level: wl })
    );
    watch(mouseValues.scrollVal, (slice) =>
      view2DStore.setSlice(viewID, slice)
    );

    // --- template vars --- //

    return {
      vtkContainerRef,
      active: true,
      slice: currentSlice,
      sliceMin,
      sliceMax,
      windowWidth,
      windowLevel,
      setSlice: (slice: number) => view2DStore.setSlice(viewID, slice),
    };
  },
});
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

.overlay {
  position: absolute;
  width: 100%;
  height: 100%;
  top: 0;
  left: 0;
  color: white;
  /* simulate text border */
  /* prettier-ignore */
  text-shadow:  1px  1px black,
                1px -1px black,
               -1px -1px black,
               -1px  1px black,
                0px  1px black,
                0px -1px black,
                1px  0px black,
               -1px  0px black;
  /* increase kerning to compensate for border */
  letter-spacing: 1px;
  font-size: clamp(8px, 0.75vw, 16px);
  /* handle text overflow */
  overflow: hidden;
  text-overflow: ellipsis;
}

.overlay-cell {
  padding: 4px;
  white-space: nowrap;
}
</style>
