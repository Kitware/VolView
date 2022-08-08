<template>
  <div class="vtk-container-wrapper">
    <div class="vtk-gutter">
      <v-tooltip right transition="slide-x-transition">
        <template v-slot:activator="{ on, attrs }">
          <v-btn x-small icon @click="resetCamera" v-bind="attrs" v-on="on">
            <v-icon small class="py-1">mdi-camera-flip-outline</v-icon>
          </v-btn>
        </template>
        <span>Reset camera</span>
      </v-tooltip>
    </div>
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
import vtkPiecewiseFunctionProxy from '@kitware/vtk.js/Proxy/Core/PiecewiseFunctionProxy';

import {
  getShiftedOpacityFromPreset,
  useView3DStore,
} from '@/src/store/views-3D';
import { useProxyManager } from '@/src/composables/proxyManager';
import ViewOverlayGrid from '@src/components/ViewOverlayGrid.vue';
import { useResizeObserver } from '../composables/useResizeObserver';
import { LPSAxisDir } from '../utils/lps';
import { useCurrentImage } from '../composables/useCurrentImage';
import { useCameraOrientation } from '../composables/useCameraOrientation';
import vtkLPSView3DProxy from '../vtk/LPSView3DProxy';
import { useSceneBuilder } from '../composables/useSceneBuilder';
import { useViewConfigStore } from '../store/view-configs';
import { usePersistCameraConfig } from '../composables/usePersistCameraConfig';

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
    ViewOverlayGrid,
  },
  setup(props) {
    const view3DStore = useView3DStore();
    const proxyManager = useProxyManager()!;
    const viewConfigStore = useViewConfigStore();

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
      currentImageData,
      isImageLoading,
    } = useCurrentImage();

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
        let cameraConfig = null;
        if (curImageID.value !== null) {
          cameraConfig = viewConfigStore.getCameraConfig(
            viewID,
            curImageID.value
          );
        }

        // We don't want to reset the camera if we have a config we are restoring
        if (cameraConfig === null) {
          resetCamera();
        }
      },
      {
        immediate: true,
        deep: true,
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

    watch([curImageID], () => {
      // See if we have a camera configuration to restore
      let cameraConfig = null;
      if (curImageID.value !== null) {
        cameraConfig = viewConfigStore.getCameraConfig(
          viewID,
          curImageID.value
        );
      }

      if (cameraConfig) {
        restoreCameraConfig(cameraConfig);

        viewProxy.getRenderer().resetCameraClippingRange();
        viewProxy.render();
      }
    });

    // --- coloring --- //

    const coloringConfig = computed(() => view3DStore.coloringConfig);
    const colorBy = computed(() => coloringConfig.value.colorBy);
    const colorTransferFunction = computed(
      () => coloringConfig.value.transferFunction
    );
    const opacityFunction = computed(
      () => coloringConfig.value.opacityFunction
    );

    watchEffect(() => {
      const rep = baseImageRep.value;
      const { arrayName, location } = colorBy.value;
      const { mappingRange, preset } = colorTransferFunction.value;

      const lut = proxyManager.getLookupTable(arrayName);
      lut.setMode(vtkLookupTableProxy.Mode.Preset);
      lut.setPresetName(preset);
      lut.setDataRange(...mappingRange);

      const pwf = proxyManager.getPiecewiseFunction(arrayName);
      const opFunc = opacityFunction.value;
      pwf.setMode(opFunc.mode);

      switch (opFunc.mode) {
        case vtkPiecewiseFunctionProxy.Mode.Gaussians:
          pwf.setGaussians(opFunc.gaussians);
          break;
        case vtkPiecewiseFunctionProxy.Mode.Points: {
          const opacityPoints = getShiftedOpacityFromPreset(
            opFunc.preset,
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

      if (rep) {
        rep.setColorBy(arrayName, location);
      }
    });

    // --- persistent coloring setup --- //

    // restore volume coloring configuration
    // must run before the save watcher
    watch(curImageID, (imageID) => {
      if (imageID && currentImageData.value) {
        const config = viewConfigStore.getVolumeColorConfig(viewID, imageID);
        if (config) {
          view3DStore.setColorBy(
            config.colorBy.arrayName,
            config.colorBy.location
          );
          view3DStore.updateColorTransferFunction(config.transferFunction);
          view3DStore.updateOpacityFunction(config.opacityFunction);
        } else {
          view3DStore.resetToDefaultColoring(currentImageData.value);
        }
      }
    });

    // save volume coloring
    watch([colorBy, colorTransferFunction, opacityFunction], () => {
      const imageID = curImageID.value;
      if (imageID) {
        viewConfigStore.setVolumeColoring(viewID, imageID, {
          colorBy: colorBy.value,
          transferFunction: colorTransferFunction.value,
          opacityFunction: opacityFunction.value,
        });
      }
    });

    // --- template vars --- //

    return {
      vtkContainerRef,
      active: false,
      topLeftLabel: computed(() =>
        colorTransferFunction.value.preset.replace(/-/g, ' ')
      ),
      isImageLoading,
      resetCamera,
    };
  },
});
</script>

<style scoped src="@/src/components/styles/vtk-view.css"></style>
