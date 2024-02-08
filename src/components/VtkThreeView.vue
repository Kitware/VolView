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
        <crop-tool :view-id="viewID" />
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
            <span class="ml-3">{{ topLeftLabel }}</span>
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
  onBeforeUnmount,
  onMounted,
  PropType,
  ref,
  toRefs,
  watch,
  nextTick,
} from 'vue';
import { vec3 } from 'gl-matrix';

import vtkVolumeRepresentationProxy from '@kitware/vtk.js/Proxy/Representations/VolumeRepresentationProxy';
import { useProxyRepresentation } from '@/src/composables/useProxyRepresentations';
import ViewOverlayGrid from '@/src/components/ViewOverlayGrid.vue';
import { useCvrEffect } from '@/src/composables/useCvrEffect';
import { useColoringEffect } from '@/src/composables/useColoringEffect';
import { useResizeObserver } from '../composables/useResizeObserver';
import { useCurrentImage } from '../composables/useCurrentImage';
import { useCameraOrientation } from '../composables/useCameraOrientation';
import vtkLPSView3DProxy from '../vtk/LPSView3DProxy';
import { usePersistCameraConfig } from '../composables/usePersistCameraConfig';
import { LPSAxisDir } from '../types/lps';
import { useViewProxy } from '../composables/useViewProxy';
import { ViewProxyType } from '../core/proxies';
import useVolumeColoringStore from '../store/view-configs/volume-coloring';
import CropTool from './tools/crop/CropTool.vue';
import PanTool from './tools/PanTool.vue';
import { useCropStore, croppingPlanesEqual } from '../store/tools/crop';
import useViewCameraStore from '../store/view-configs/camera';
import { useResetViewsEvents } from './tools/ResetViews.vue';

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
    CropTool,
    PanTool,
  },
  setup(props) {
    const volumeColoringStore = useVolumeColoringStore();
    const viewCameraStore = useViewCameraStore();

    const { id: viewID, viewDirection, viewUp } = toRefs(props);

    const vtkContainerRef = ref<HTMLElement>();

    // --- computed vars --- //

    const {
      currentImageID: curImageID,
      currentImageMetadata: curImageMetadata,
      currentImageData,
      isImageLoading,
    } = useCurrentImage();

    // --- view proxy setup --- //

    const { viewProxy } = useViewProxy<vtkLPSView3DProxy>(
      viewID,
      ViewProxyType.Volume
    );

    onMounted(() => {
      viewProxy.value.setOrientationAxesVisibility(true);
      viewProxy.value.setOrientationAxesType('cube');
      viewProxy.value.setBackground([0, 0, 0, 0]);
      viewProxy.value.setContainer(vtkContainerRef.value ?? null);
    });

    onBeforeUnmount(() => {
      viewProxy.value.setContainer(null);
    });

    useResizeObserver(vtkContainerRef, () => viewProxy.value.resize());

    // --- scene setup --- //

    const { representation: baseImageRep } =
      useProxyRepresentation<vtkVolumeRepresentationProxy>(curImageID, viewID);

    // --- picking --- //

    // disables picking for crop control and more
    watch(
      baseImageRep,
      (rep) => {
        if (rep) {
          rep.getVolumes().forEach((volume) => volume.setPickable(false));
        }
      },
      { immediate: true }
    );

    // --- camera setup --- //

    const { cameraUpVec, cameraDirVec } = useCameraOrientation(
      viewDirection,
      viewUp,
      curImageMetadata
    );

    const resetCamera = () => {
      const bounds = curImageMetadata.value.worldBounds;
      const center = [
        (bounds[0] + bounds[1]) / 2,
        (bounds[2] + bounds[3]) / 2,
        (bounds[4] + bounds[5]) / 2,
      ] as vec3;

      viewProxy.value.updateCamera(
        cameraDirVec.value,
        cameraUpVec.value,
        center
      );
      viewProxy.value.resetCamera();
      viewProxy.value.renderLater();
    };

    watch(
      [baseImageRep, cameraDirVec, cameraUpVec],
      () => {
        const cameraConfig = viewCameraStore.getConfig(
          viewID.value,
          curImageID.value
        );

        // We don't want to reset the camera if we have a config we are restoring
        if (!cameraConfig) {
          // nextTick ensures resetCamera gets called after
          // useSceneBuilder refreshes the scene.
          nextTick(resetCamera);
        }
      },
      {
        immediate: true,
      }
    );

    const { restoreCameraConfig } = usePersistCameraConfig(
      viewID,
      curImageID,
      viewProxy,
      'position',
      'focalPoint',
      'directionOfProjection',
      'viewUp'
    );

    watch(curImageID, () => {
      // See if we have a camera configuration to restore
      const cameraConfig = viewCameraStore.getConfig(
        viewID.value,
        curImageID.value
      );

      if (cameraConfig) {
        restoreCameraConfig(cameraConfig);

        viewProxy.value.getRenderer().resetCameraClippingRange();
        viewProxy.value.renderLater();
      }
    });

    // --- coloring setup --- //

    const volumeColorConfig = computed(() =>
      volumeColoringStore.getConfig(viewID.value, curImageID.value)
    );

    watch(
      [viewID, curImageID],
      () => {
        if (
          curImageID.value &&
          currentImageData.value &&
          !volumeColorConfig.value
        ) {
          volumeColoringStore.resetToDefaultColoring(
            viewID.value,
            curImageID.value,
            currentImageData.value
          );
        }
      },
      { immediate: true }
    );

    // --- CVR parameters --- //

    useCvrEffect(volumeColorConfig, baseImageRep, viewProxy);

    // --- coloring --- //

    useColoringEffect(volumeColorConfig, baseImageRep, viewProxy);

    // --- cropping planes --- //

    const cropStore = useCropStore();
    const croppingPlanes = cropStore.getComputedVTKPlanes(curImageID);

    watch(
      croppingPlanes,
      (planes, oldPlanes) => {
        const mapper = baseImageRep.value?.getMapper();
        if (
          !mapper ||
          !planes ||
          (oldPlanes && croppingPlanesEqual(planes, oldPlanes))
        )
          return;

        mapper.removeAllClippingPlanes();
        planes.forEach((plane) => mapper.addClippingPlane(plane));
        mapper.modified();
        viewProxy.value.renderLater();
      },
      { immediate: true }
    );

    // --- Listen to ResetViews event --- //
    const events = useResetViewsEvents();
    events.onClick(() => resetCamera());

    // --- template vars --- //

    return {
      vtkContainerRef,
      viewID,
      active: false,
      topLeftLabel: computed(
        () =>
          volumeColorConfig.value?.transferFunction.preset.replace(/-/g, ' ') ??
          ''
      ),
      isImageLoading,
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
