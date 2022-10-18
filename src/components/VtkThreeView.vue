<template>
  <div class="vtk-container-wrapper vtk-three-container">
    <div class="vtk-container" :class="active ? 'active' : ''">
      <div class="vtk-sub-container">
        <div class="vtk-view" ref="vtkContainerRef" />
      </div>
      <div class="overlay-no-events tool-layer">
        <crop-tool :view-id="viewID" />
      </div>
      <view-overlay-grid class="overlay-no-events view-annotations">
        <template v-slot:top-left>
          <div class="annotation-cell">
            <v-tooltip bottom transition="slide-x-transition">
              <template v-slot:activator="{ on, attrs }">
                <v-btn
                  class="pointer-events-all"
                  dark
                  x-small
                  icon
                  @click="resetCamera"
                  v-bind="attrs"
                  v-on="on"
                >
                  <v-icon small class="py-1">mdi-camera-flip-outline</v-icon>
                </v-btn>
              </template>
              <span>Reset camera</span>
            </v-tooltip>
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
} from '@vue/composition-api';
import { mat3, vec3 } from 'gl-matrix';

import vtkVolumeRepresentationProxy from '@kitware/vtk.js/Proxy/Representations/VolumeRepresentationProxy';
import vtkLookupTableProxy from '@kitware/vtk.js/Proxy/Core/LookupTableProxy';
import vtkPiecewiseFunctionProxy from '@kitware/vtk.js/Proxy/Core/PiecewiseFunctionProxy';
import vtkVolumeMapper from '@kitware/vtk.js/Rendering/Core/VolumeMapper';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import { getDiagonalLength } from '@kitware/vtk.js/Common/DataModel/BoundingBox';
import vtkLight from '@kitware/vtk.js/Rendering/Core/Light';
import { Vector3 } from '@kitware/vtk.js/types';

import { useProxyManager } from '@/src/composables/proxyManager';
import ViewOverlayGrid from '@src/components/ViewOverlayGrid.vue';
import { useResizeObserver } from '../composables/useResizeObserver';
import { getLPSAxisFromDir, getLPSDirections } from '../utils/lps';
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
import { useWidgetManager } from '../composables/useWidgetManager';
import { VTKThreeViewWidgetManager } from '../constants';
import { useCropStore } from '../store/tools/crop';

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
    watch(baseImageRep, (rep) => {
      if (rep) {
        rep.getVolumes().forEach((volume) => volume.setPickable(false));
      }
    });

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

    watch([viewID, curImageID], () => {
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
    });

    // --- CVR parameters --- //

    const cvrParams = computed(() => volumeColorConfig.value?.cvr);
    const cvrEnabled = computed(() => !!cvrParams.value?.enabled);

    watch(
      cvrEnabled,
      (enabled) => {
        const renderer = viewProxy.value.getRenderer();
        renderer.removeAllLights();
        if (enabled) {
          const light = vtkLight.newInstance();
          light.setPositional(true);
          light.setLightTypeToSceneLight();
          light.setColor(1, 1, 1);
          light.setIntensity(1);
          light.setConeAngle(90);
          renderer.addLight(light);
          renderer.setTwoSidedLighting(false);
        } else {
          renderer.createLight();
          renderer.setTwoSidedLighting(true);
        }
      },
      { immediate: true }
    );

    const cvrLightOffset = computed(() => {
      const image = currentImageData.value;
      const lps = getLPSDirections(curImageMetadata.value.orientation as mat3);
      const dir = lps[viewDirection.value];
      const axisIndex = lps[getLPSAxisFromDir(viewDirection.value)];
      const lightFlip = cvrParams.value?.flipLightPosition ? 1 : -1;
      if (image) {
        const dim = image.getDimensions()[axisIndex];
        return dir.map((v) => v * lightFlip * dim);
      }
      return dir;
    });

    watch(
      [cvrParams, baseImageRep],
      ([params, rep]) => {
        const image = rep?.getInputDataSet() as vtkImageData | null | undefined;
        if (!rep || !image || !params) {
          return;
        }

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

        if (params.enabled) {
          // set positional light position
          const light = renderer.getLights()[0];
          light.setFocalPoint(...center);
          if (params.fixedLightPosition) {
            light.setLightTypeToHeadLight();
          } else {
            light.setLightTypeToSceneLight();
            light.setPosition(
              center[0] + cvrLightOffset.value[0],
              center[1] + cvrLightOffset.value[1],
              center[2] + cvrLightOffset.value[2]
            );
          }
        }

        const sampleDistance =
          1.5 *
          Math.sqrt(
            image
              .getSpacing()
              .map((v) => v * v)
              .reduce((sum, v) => sum + v, 0)
          );

        mapper.setSampleDistance(sampleDistance / 10);

        mapper.setGlobalIlluminationReach(params.enabled ? 0.5 : 0);
        property.setShade(true);
        property.setScalarOpacityUnitDistance(
          0,
          getDiagonalLength(image.getBounds()) /
            Math.max(...image.getDimensions())
        );
        property.setUseGradientOpacity(0, !params.enabled);
        property.setGradientOpacityMinimumValue(0, 0.0);
        const dataRange = image.getPointData().getScalars().getRange();
        property.setGradientOpacityMaximumValue(
          0,
          (dataRange[1] - dataRange[0]) * 0.01
        );
        property.setGradientOpacityMinimumOpacity(0, 0.0);
        property.setGradientOpacityMinimumOpacity(0, 1.0);

        if (params.enabled && params.useVolumetricScatteringBlending) {
          mapper.setVolumetricScatteringBlending(
            params.volumetricScatteringBlending
          );
        } else {
          mapper.setVolumetricScatteringBlending(0);
        }

        // Local ambient occlusion
        if (params.enabled && params.useLocalAmbientOcclusion) {
          mapper.setLocalAmbientOcclusion(true);
          mapper.setLAOKernelSize(params.laoKernelSize);
          mapper.setLAOKernelRadius(params.laoKernelRadius);
        } else {
          mapper.setLocalAmbientOcclusion(false);
          mapper.setLAOKernelSize(0);
          mapper.setLAOKernelRadius(0);
        }

        property.setAmbient(params.enabled ? params.ambient : DEFAULT_AMBIENT);
        property.setDiffuse(params.enabled ? params.diffuse : DEFAULT_DIFFUSE);
        property.setSpecular(
          params.enabled ? params.specular : DEFAULT_SPECULAR
        );
      viewProxy.value.render();
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
        lut.setMode(vtkLookupTableProxy.Mode.Preset);
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
