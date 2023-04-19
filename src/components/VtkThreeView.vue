<template>
  <div class="vtk-container-wrapper vtk-three-container">
    <div class="vtk-container" :class="active ? 'active' : ''">
      <div class="vtk-sub-container">
        <div class="vtk-view" ref="vtkContainerRef" />
      </div>
      <div class="overlay-no-events tool-layer">
        <crop-tool :view-id="viewID" />
        <pan-tool :view-id="viewID" />
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
  provide,
  ref,
  toRefs,
  watch,
} from 'vue';
import { vec3 } from 'gl-matrix';

import vtkVolumeRepresentationProxy from '@kitware/vtk.js/Proxy/Representations/VolumeRepresentationProxy';
import { Mode as LookupTableProxyMode } from '@kitware/vtk.js/Proxy/Core/LookupTableProxy';
import vtkPiecewiseFunctionProxy from '@kitware/vtk.js/Proxy/Core/PiecewiseFunctionProxy';
import vtkVolumeMapper from '@kitware/vtk.js/Rendering/Core/VolumeMapper';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import { getDiagonalLength } from '@kitware/vtk.js/Common/DataModel/BoundingBox';
import { Vector3 } from '@kitware/vtk.js/types';

import { useProxyManager } from '@/src/composables/proxyManager';
import ViewOverlayGrid from '@src/components/ViewOverlayGrid.vue';
import { useResizeObserver } from '../composables/useResizeObserver';
import { useCurrentImage } from '../composables/useCurrentImage';
import { useCameraOrientation } from '../composables/useCameraOrientation';
import vtkLPSView3DProxy from '../vtk/LPSView3DProxy';
import { useSceneBuilder } from '../composables/useSceneBuilder';
import { useViewConfigStore } from '../store/view-configs';
import { usePersistCameraConfig } from '../composables/usePersistCameraConfig';
import { useModelStore } from '../store/datasets-models';
import { LPSAxisDir } from '../types/lps';
import { useViewProxy } from '../composables/useViewProxy';
import { ViewProxyType } from '../core/proxies';
import { CameraConfig } from '../store/view-configs/types';
import {
  DEFAULT_AMBIENT,
  DEFAULT_DIFFUSE,
  DEFAULT_SPECULAR,
} from '../store/view-configs/volume-coloring';
import { getShiftedOpacityFromPreset } from '../utils/vtk-helpers';
import CropTool from './tools/CropTool.vue';
import PanTool from './tools/PanTool.vue';
import { useWidgetManager } from '../composables/useWidgetManager';
import { VTKThreeViewWidgetManager } from '../constants';
import { useCropStore } from '../store/tools/crop';
import { isViewAnimating } from '../composables/isViewAnimating';

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
    const modelStore = useModelStore();
    const proxyManager = useProxyManager()!;
    const viewConfigStore = useViewConfigStore();

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

    const { viewProxy, setContainer: setViewProxyContainer } =
      useViewProxy<vtkLPSView3DProxy>(viewID, ViewProxyType.Volume);

    onMounted(() => {
      viewProxy.value.setOrientationAxesVisibility(true);
      viewProxy.value.setOrientationAxesType('cube');
      viewProxy.value.setBackground([0, 0, 0, 0]);
      setViewProxyContainer(vtkContainerRef.value);
    });

    onBeforeUnmount(() => {
      setViewProxyContainer(null);
      viewProxy.value.setContainer(null);
    });

    useResizeObserver(vtkContainerRef, () => viewProxy.value.resize());

    // --- scene setup --- //

    const { baseImageRep } = useSceneBuilder<vtkVolumeRepresentationProxy>(
      viewID,
      {
        baseImage: curImageID,
        models: computed(() => modelStore.idList),
      }
    );

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

    // --- widget manager --- //

    const { widgetManager } = useWidgetManager(viewProxy);
    provide(VTKThreeViewWidgetManager, widgetManager);

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
      viewProxy.value.render();
    };

    watch(
      [baseImageRep, cameraDirVec, cameraUpVec],
      () => {
        let cameraConfig: CameraConfig | undefined;
        if (curImageID.value !== null) {
          cameraConfig = viewConfigStore.getCameraConfig(
            viewID.value,
            curImageID.value
          );
        }

        // We don't want to reset the camera if we have a config we are restoring
        if (!cameraConfig) {
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

    watch(curImageID, () => {
      // See if we have a camera configuration to restore
      let cameraConfig = null;
      if (curImageID.value !== null) {
        cameraConfig = viewConfigStore.getCameraConfig(
          viewID.value,
          curImageID.value
        );
      }

      if (cameraConfig) {
        restoreCameraConfig(cameraConfig);

        viewProxy.value.getRenderer().resetCameraClippingRange();
        viewProxy.value.render();
      }
    });

    // --- coloring setup --- //

    const volumeColorConfig = viewConfigStore.getComputedVolumeColorConfig(
      viewID,
      curImageID
    );

    watch(
      [viewID, curImageID],
      () => {
        if (
          curImageID.value &&
          currentImageData.value &&
          !volumeColorConfig.value
        ) {
          viewConfigStore.resetToDefaultColoring(
            viewID.value,
            curImageID.value,
            currentImageData.value
          );
        }
      },
      { immediate: true }
    );

    // --- CVR parameters --- //

    const cvrParams = computed(() => volumeColorConfig.value?.cvr);
    const isAnimating = isViewAnimating(viewProxy);

    watch(
      [cvrParams, baseImageRep, isAnimating],
      ([params, rep, animating]) => {
        const image = rep?.getInputDataSet() as vtkImageData | null | undefined;
        if (!rep || !image || !params) {
          return;
        }

        // disable CVR while animating for smoother interaction
        const enabled = params.enabled && !animating;

        const renderer = viewProxy.value.getRenderer();
        const mapper = rep.getMapper() as vtkVolumeMapper;
        const volume = rep.getVolumes()[0];
        const property = volume.getProperty();

        const volumeBounds = volume.getBounds();
        const center = [
          (volumeBounds[0] + volumeBounds[1]) / 2,
          (volumeBounds[2] + volumeBounds[3]) / 2,
          (volumeBounds[4] + volumeBounds[5]) / 2,
        ] as Vector3;

        if (renderer.getLights().length === 0) {
          renderer.createLight();
        }
        const light = renderer.getLights()[0];
        if (enabled) {
          light.setFocalPoint(...center);
          light.setColor(1, 1, 1);
          light.setIntensity(1);
          light.setConeAngle(90);
          light.setPositional(true);
          renderer.setTwoSidedLighting(false);
          if (params.lightFollowsCamera) {
            light.setLightTypeToHeadLight();
            renderer.updateLightsGeometryToFollowCamera();
          } else {
            light.setLightTypeToSceneLight();
          }
        } else {
          light.setPositional(false);
        }

        property.setScalarOpacityUnitDistance(
          0,
          (0.5 * getDiagonalLength(image.getBounds())) /
            Math.max(...image.getDimensions())
        );
        if (animating) {
          mapper.setSampleDistance(0.75);
          mapper.setMaximumSamplesPerRay(1000);
          mapper.setGlobalIlluminationReach(0);
        } else {
          const dims = image.getDimensions();
          const spacing = image.getSpacing();
          const spatialDiagonal = vec3.length(
            vec3.fromValues(
              dims[0] * spacing[0],
              dims[1] * spacing[1],
              dims[2] * spacing[2]
            )
          );

          // Use the average spacing for sampling by default
          let sampleDistance = spacing.reduce((a, b) => a + b) / 3.0;
          // Adjust the volume sampling by the quality slider value
          sampleDistance /= 0.5 * (params.volumeQuality * params.volumeQuality);
          const samplesPerRay = spatialDiagonal / sampleDistance + 1;
          mapper.setMaximumSamplesPerRay(samplesPerRay);
          mapper.setSampleDistance(sampleDistance);
          // Adjust the global illumination reach by volume quality slider
          mapper.setGlobalIlluminationReach(
            enabled ? 0.25 * params.volumeQuality : 0
          );
        }

        property.setShade(true);
        property.setUseGradientOpacity(0, !enabled);
        property.setGradientOpacityMinimumValue(0, 0.0);
        const dataRange = image.getPointData().getScalars().getRange();
        property.setGradientOpacityMaximumValue(
          0,
          (dataRange[1] - dataRange[0]) * 0.01
        );
        property.setGradientOpacityMinimumOpacity(0, 0.0);
        property.setGradientOpacityMinimumOpacity(0, 1.0);

        if (enabled && params.useVolumetricScatteringBlending) {
          mapper.setVolumetricScatteringBlending(
            params.volumetricScatteringBlending
          );
        } else {
          mapper.setVolumetricScatteringBlending(0);
        }

        // Local ambient occlusion
        if (enabled && params.useLocalAmbientOcclusion) {
          mapper.setLocalAmbientOcclusion(true);
          mapper.setLAOKernelSize(params.laoKernelSize);
          mapper.setLAOKernelRadius(params.laoKernelRadius);
        } else {
          mapper.setLocalAmbientOcclusion(false);
          mapper.setLAOKernelSize(0);
          mapper.setLAOKernelRadius(0);
        }

        // do not toggle these parameters when animating
        property.setAmbient(params.enabled ? params.ambient : DEFAULT_AMBIENT);
        property.setDiffuse(params.enabled ? params.diffuse : DEFAULT_DIFFUSE);
        property.setSpecular(
          params.enabled ? params.specular : DEFAULT_SPECULAR
        );

        if (!animating) {
          viewProxy.value.render();
        }
      },
      { deep: true, immediate: true }
    );

    // --- coloring --- //

    const colorBy = computed(() => volumeColorConfig.value?.colorBy);
    const colorTransferFunction = computed(
      () => volumeColorConfig.value?.transferFunction
    );
    const opacityFunction = computed(
      () => volumeColorConfig.value?.opacityFunction
    );

    watch(
      [baseImageRep, colorBy, colorTransferFunction, opacityFunction],
      () => {
        if (
          !baseImageRep.value ||
          !colorBy.value ||
          !colorTransferFunction.value ||
          !opacityFunction.value
        ) {
          return;
        }

        const rep = baseImageRep.value;

        const { arrayName, location } = colorBy.value;
        const ctFunc = colorTransferFunction.value;
        const opFunc = opacityFunction.value;

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

        if (rep) {
          rep.setColorBy(arrayName, location);
        }

        // Need to trigger a render for when we are restoring from a state file
        viewProxy.value.render();
      },
      { immediate: true, deep: true }
    );

    // --- cropping planes --- //

    const cropStore = useCropStore();
    const croppingPlanes = cropStore.getComputedVTKPlanes(curImageID);

    watch(
      croppingPlanes,
      (planes) => {
        const mapper = baseImageRep.value?.getMapper();
        if (planes && mapper) {
          mapper.removeAllClippingPlanes();
          planes.forEach((plane) => mapper.addClippingPlane(plane));
          mapper.modified();
          viewProxy.value.render();
        }
      },
      { immediate: true }
    );

    // --- template vars --- //

    return {
      vtkContainerRef,
      viewID,
      active: false,
      topLeftLabel: computed(
        () => colorTransferFunction.value?.preset.replace(/-/g, ' ') ?? ''
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
