<template>
  <div class="vtk-container-wrapper">
    <div class="vtk-gutter"></div>
    <div class="vtk-container" :class="active ? 'active' : ''">
      <div class="vtk-sub-container">
        <div class="vtk-view" ref="vtkContainerRef" />
      </div>
      <view-overlay-grid class="overlay-no-events view-annotations">
        <template v-slot:top-left>
          <div class="annotation-cell">
            <span>{{ topLeftLabel }}</span>
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
  watchEffect,
} from '@vue/composition-api';
import { vec3 } from 'gl-matrix';

import vtkVolumeRepresentationProxy from '@kitware/vtk.js/Proxy/Representations/VolumeRepresentationProxy';
import vtkLookupTableProxy from '@kitware/vtk.js/Proxy/Core/LookupTableProxy';

import { useView3DStore } from '@/src/store/views-3D';
import { useProxyManager } from '@/src/composables/proxyManager';

import SliceSlider from '@src/components/SliceSlider.vue';
import ViewOverlayGrid from '@src/componentsX/ViewOverlayGrid.vue';
import { useResizeObserver } from '../composables/useResizeObserver';
import { LPSAxisDir } from '../utils/lps';
import { useCurrentImage } from '../composables/useCurrentImage';
import { useCameraOrientation } from '../composables/useCameraOrientation';
import vtkLPSView3DProxy from '../vtk/LPSView3DProxy';
import { useSceneBuilder } from '../composables/useSceneBuilder';

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
    const view3DStore = useView3DStore();
    const proxyManager = useProxyManager()!;

    const { viewDirection, viewUp } = toRefs(props);

    const vtkContainerRef = ref<HTMLElement>();

    // --- view creation --- //

    // TODO changing the viewDirection prop is not supported at this time.
    const { id: viewID, proxy: viewProxy } =
      view3DStore.createView<vtkLPSView3DProxy>();

    // --- computed vars --- //

    const {
      currentImageID: curImageID,
      currentImageMetadata: curImageMetadata,
      isImageLoading,
    } = useCurrentImage();

    const coloringConfig = computed(() => view3DStore.coloringConfig);
    const colorBy = computed(() => coloringConfig.value.colorBy);
    const colorTransferFuncName = computed(
      () => coloringConfig.value.transferFunction
    );

    // --- view proxy setup --- //

    onMounted(() => {
      viewProxy.setOrientationAxesVisibility(true);
      viewProxy.setOrientationAxesType('cube');
      viewProxy.setBackground([0.1, 0.2, 0.3]);
      viewProxy.setContainer(vtkContainerRef.value ?? null);
    });

    onBeforeUnmount(() => {
      viewProxy.setContainer(null);
      view3DStore.removeView(viewID);
    });

    useResizeObserver(vtkContainerRef, () => viewProxy.resize());

    // --- scene setup --- //

    const { baseImageRep } = useSceneBuilder<vtkVolumeRepresentationProxy>(
      viewID,
      {
        baseImage: curImageID,
      }
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

      viewProxy.updateCamera(cameraDirVec.value, cameraUpVec.value, center);
      viewProxy.resetCamera();
      viewProxy.render();
    };

    watch(
      [baseImageRep, cameraDirVec, cameraUpVec],
      () => {
        resetCamera();
      },
      {
        immediate: true,
        deep: true,
      }
    );

    // --- coloring --- //

    watchEffect(() => {
      const rep = baseImageRep.value;
      const { arrayName, location } = colorBy.value;

      // TODO move lut stuff to proxymanager sync code
      const lut = proxyManager.getLookupTable(arrayName);
      lut.setMode(vtkLookupTableProxy.Mode.Preset);
      lut.setPresetName(colorTransferFuncName.value);
      if (rep) {
        rep.setColorBy(arrayName, location);
      }
    });

    // --- template vars --- //

    return {
      vtkContainerRef,
      active: false,
      topLeftLabel: colorTransferFuncName,
      isImageLoading,
    };
  },
});
</script>

<style scoped src="@/src/assets/styles/vtk-view.css"></style>
