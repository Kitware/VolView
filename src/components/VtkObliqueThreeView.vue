<template>
  <div class="vtk-container-wrapper vtk-three-container">
    <div class="vtk-container" :class="active ? 'active' : ''">
      <div class="vtk-sub-container">
        <div
          class="vtk-view"
          ref="vtkContainerRef"
          data-testid="vtk-view vtk-three-view"
        />
      </div>
      <div class="overlay-no-events tool-layer">
        <pan-tool :viewId="viewID" />
      </div>
      <view-overlay-grid class="overlay-no-events view-annotations">
        <template v-slot:top-left>
          <div class="annotation-cell">
            <v-btn
              class="pointer-events-all"
              dark
              icon
              size="medium"
              variant="text"
              @click="resetCamera"
            >
              <v-icon size="medium" class="py-1">
                mdi-camera-flip-outline
              </v-icon>
              <v-tooltip
                location="right"
                activator="parent"
                transition="slide-x-transition"
              >
                Reset Camera
              </v-tooltip>
            </v-btn>
          </div>
        </template>
      </view-overlay-grid>
    </div>
  </div>
</template>

<script lang="ts">
import {
  computed,
  defineComponent,
  inject,
  onBeforeUnmount,
  onMounted,
  PropType,
  ref,
  toRefs,
  watch,
} from 'vue';
import { storeToRefs } from 'pinia';

import vtkImageDataOutlineFilter from '@kitware/vtk.js/Filters/General/ImageDataOutlineFilter';
import vtkGeometryRepresentationProxy from '@kitware/vtk.js/Proxy/Representations/GeometryRepresentationProxy';
import vtkBoundingBox from '@kitware/vtk.js/Common/DataModel/BoundingBox';

import ViewOverlayGrid from '@src/components/ViewOverlayGrid.vue';
import { useVTKCallback } from '@/src/composables/useVTKCallback';
import PanTool from './tools/PanTool.vue';
import { LPSAxisDir } from '../types/lps';
import { useViewProxy } from '../composables/useViewProxy';
import vtkLPSView3DProxy from '../vtk/LPSView3DProxy';
import vtkLPSView2DProxy from '../vtk/LPSView2DProxy';
import { ViewProxyType } from '../core/proxies';
import { useCurrentImage } from '../composables/useCurrentImage';
import { useCameraOrientation } from '../composables/useCameraOrientation';
import { InitViewIDs } from '../config';
import { useResizeObserver } from '../composables/useResizeObserver';
import { useCustomEvents } from '../store/custom-events';
import { VTKResliceCursor } from '../constants';
import { useSceneBuilder } from '../composables/useSceneBuilder';
import useWindowingStore from '../store/view-configs/windowing';

export default defineComponent({
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
    ViewOverlayGrid,
    PanTool,
  },
  setup(props) {
    const { id: viewID, viewDirection, viewUp } = toRefs(props);
    const vtkContainerRef = ref<HTMLElement>();

    // --- computed vars --- //
    const { currentImageData, currentImageID, currentImageMetadata } = useCurrentImage();

    // --- view proxy setup --- //

    const { viewProxy, setContainer: setViewProxyContainer } =
      useViewProxy<vtkLPSView3DProxy>(viewID, ViewProxyType.Oblique3D);

    const { baseImageRep } = useSceneBuilder<vtkGeometryRepresentationProxy>(viewID, {
      baseImage: currentImageID
    });

    // Get a 2D Oblique view proxy to fetch the reslice representations.
    // We don't create new reslice reps, we just re-use those already
    // created by the 2D Oblique Views.
    const oblique2DViewProxies = computed(() => {
      const { viewProxy: obliqueAxialViewProxy } =
        useViewProxy<vtkLPSView2DProxy>(InitViewIDs.ObliqueAxial, ViewProxyType.Oblique);
      const { viewProxy: obliqueSagittalViewProxy } =
        useViewProxy<vtkLPSView2DProxy>(InitViewIDs.ObliqueSagittal, ViewProxyType.Oblique);
      const { viewProxy: obliqueCoronalViewProxy } =
        useViewProxy<vtkLPSView2DProxy>(InitViewIDs.ObliqueCoronal, ViewProxyType.Oblique);
      return [obliqueAxialViewProxy, obliqueSagittalViewProxy, obliqueCoronalViewProxy];
    });

    function addResliceProxiesToView(): void {
      oblique2DViewProxies.value?.forEach((proxyRef) => {
        const reps = proxyRef.value?.getRepresentations();
        if (reps && reps.length > 0) {
          viewProxy.value.addRepresentation(reps[0]);
        }
      });
    }

    onBeforeUnmount(() => {
      setViewProxyContainer(null);
      viewProxy.value.setContainer(null);
    });

    onMounted(() => {
      viewProxy.value.setOrientationAxesVisibility(true);
      viewProxy.value.setOrientationAxesType('cube');
      viewProxy.value.setBackground([0, 0, 0, 0]);
      viewProxy.value.getCamera().setParallelProjection(true);
      setViewProxyContainer(vtkContainerRef.value);
      addResliceProxiesToView();
    });

    const resliceCursorRef = inject(VTKResliceCursor);
    if (!resliceCursorRef) {
      throw Error('Cannot access global ResliceCursor instance.');
    }

    const onPlanesUpdated = useVTKCallback(
      resliceCursorRef.value.getWidgetState().onModified
    );

    onPlanesUpdated(() => {
      viewProxy.value.renderLater();
    });

    // --- camera setup --- //

    const { cameraUpVec, cameraDirVec } = useCameraOrientation(
      viewDirection,
      viewUp,
      currentImageMetadata
    );

    useResizeObserver(vtkContainerRef, () => viewProxy.value.resize());

    const resetCamera = () => {
      const bounds = currentImageMetadata.value.worldBounds;
      const center = vtkBoundingBox.getCenter(bounds);

      viewProxy.value.updateCamera(
        cameraDirVec.value,
        cameraUpVec.value,
        center
      );
      addResliceProxiesToView();
      viewProxy.value.resetCamera();
      viewProxy.value.renderLater();
    };

    // Listen to ResetViews event.
    const events = useCustomEvents();
    const { resetViews } = storeToRefs(events);
    watch(
      resetViews, () => {
        resetCamera();
    });

    watch([baseImageRep, currentImageData],
      () => {
        const image = currentImageData.value;
        const outlineRep = baseImageRep.value;
        if (image && outlineRep) {
          const outlineFilter = vtkImageDataOutlineFilter.newInstance();
          outlineFilter.setInputData(image);
          outlineFilter.setGenerateFaces(false);
          outlineFilter.setGenerateLines(true);
          outlineRep.getMapper().setInputConnection(outlineFilter.getOutputPort());
          outlineRep.setLineWidth(1.0);
          outlineRep.setOpacity(0.3);
        }

        addResliceProxiesToView();
      },
      { immediate: true }
    );

    // Track window-level setting of one of the oblique views,
    // and render-update the 3D view immediately.
    const windowingStore = useWindowingStore();
    const config = computed(() => windowingStore.getConfig(InitViewIDs.ObliqueAxial, currentImageID.value));
    watch(config, () => {
      viewProxy.value.renderLater();
      },
      { immediate: true }
    );


    return {
      vtkContainerRef,
      viewID,
      active: false,
      resetCamera,
    };
  },
});
</script>

<style scoped src="@/src/components/styles/vtk-view.css"></style>
<style scoped src="@/src/components/styles/utils.css"></style>

<style scoped>
.vtk-three-container {
  background-color: black;
  grid-template-columns: auto;
}
</style>
