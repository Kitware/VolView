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
  Ref,
  nextTick,
} from 'vue';
import { computedWithControl } from '@vueuse/core';
import { vec3 } from 'gl-matrix';

import vtkVolumeRepresentationProxy from '@kitware/vtk.js/Proxy/Representations/VolumeRepresentationProxy';
import { Mode as LookupTableProxyMode } from '@kitware/vtk.js/Proxy/Core/LookupTableProxy';
import vtkPiecewiseFunctionProxy from '@kitware/vtk.js/Proxy/Core/PiecewiseFunctionProxy';
import vtkVolumeMapper from '@kitware/vtk.js/Rendering/Core/VolumeMapper';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import { getDiagonalLength } from '@kitware/vtk.js/Common/DataModel/BoundingBox';
import type { Vector3 } from '@kitware/vtk.js/types';

import { useProxyManager } from '@/src/composables/proxyManager';
import ViewOverlayGrid from '@src/components/ViewOverlayGrid.vue';
import { useResizeObserver } from '../composables/useResizeObserver';
import { useCurrentImage } from '../composables/useCurrentImage';
import { useCameraOrientation } from '../composables/useCameraOrientation';
import vtkLPSView3DProxy from '../vtk/LPSView3DProxy';
import { useSceneBuilder } from '../composables/useSceneBuilder';
import { usePersistCameraConfig } from '../composables/usePersistCameraConfig';
import { useModelStore } from '../store/datasets-models';
import { LPSAxisDir } from '../types/lps';
import { useViewProxy } from '../composables/useViewProxy';
import { ViewProxyType } from '../core/proxies';
import { VolumeColorConfig } from '../store/view-configs/types';
import useVolumeColoringStore, {
  DEFAULT_AMBIENT,
  DEFAULT_DIFFUSE,
  DEFAULT_SPECULAR,
} from '../store/view-configs/volume-coloring';
import { getShiftedOpacityFromPreset } from '../utils/vtk-helpers';
import CropTool from './tools/CropTool.vue';
import PanTool from './tools/PanTool.vue';
import { useWidgetManager } from '../composables/useWidgetManager';
import { VTKThreeViewWidgetManager } from '../constants';
import { useCropStore, croppingPlanesEqual } from '../store/tools/crop';
import { isViewAnimating } from '../composables/isViewAnimating';
import { ColoringConfig } from '../types/views';
import useViewCameraStore from '../store/view-configs/camera';
import { Maybe } from '../types';

function useCvrEffect(
  config: Ref<Maybe<VolumeColorConfig>>,
  imageRep: Ref<vtkVolumeRepresentationProxy | null>,
  viewProxy: Ref<vtkLPSView3DProxy>
) {
  const cvrParams = computed(() => config.value?.cvr);
  const repMapper = computedWithControl(
    imageRep,
    () => imageRep.value?.getMapper() as vtkVolumeMapper | undefined
  );
  const image = computedWithControl(
    imageRep,
    () => imageRep.value?.getInputDataSet() as vtkImageData | null | undefined
  );
  const volume = computedWithControl(
    imageRep,
    () => imageRep.value?.getVolumes()[0]
  );
  const renderer = computed(() => viewProxy.value.getRenderer());
  const isAnimating = isViewAnimating(viewProxy);
  const cvrEnabled = computed(() => {
    const enabled = !!cvrParams.value?.enabled;
    const animating = isAnimating.value;
    return enabled && !animating;
  });

  const requestRender = () => {
    if (!isAnimating.value) {
      viewProxy.value.renderLater();
    }
  };

  // lights
  const volumeCenter = computed(() => {
    if (!volume.value) return null;
    const volumeBounds = volume.value.getBounds();
    return [
      (volumeBounds[0] + volumeBounds[1]) / 2,
      (volumeBounds[2] + volumeBounds[3]) / 2,
      (volumeBounds[4] + volumeBounds[5]) / 2,
    ] as Vector3;
  });
  const lightFollowsCamera = computed(
    () => cvrParams.value?.lightFollowsCamera ?? true
  );

  watch(
    [volumeCenter, renderer, cvrEnabled, lightFollowsCamera],
    ([center, ren, enabled, lightFollowsCamera_]) => {
      if (!center) return;

      if (ren.getLights().length === 0) {
        ren.createLight();
      }
      const light = ren.getLights()[0];
      if (enabled) {
        light.setFocalPoint(...center);
        light.setColor(1, 1, 1);
        light.setIntensity(1);
        light.setConeAngle(90);
        light.setPositional(true);
        ren.setTwoSidedLighting(false);
        if (lightFollowsCamera_) {
          light.setLightTypeToHeadLight();
          ren.updateLightsGeometryToFollowCamera();
        } else {
          light.setLightTypeToSceneLight();
        }
      } else {
        light.setPositional(false);
      }

      requestRender();
    },
    { immediate: true }
  );

  // sampling distance
  const volumeQuality = computed(() => cvrParams.value?.volumeQuality);

  watch(
    [volume, image, repMapper, volumeQuality, cvrEnabled, isAnimating],
    ([volume_, image_, mapper, volumeQuality_, enabled, animating]) => {
      if (!volume_ || !mapper || volumeQuality_ == null || !image_) return;

      if (animating) {
        mapper.setSampleDistance(0.75);
        mapper.setMaximumSamplesPerRay(1000);
        mapper.setGlobalIlluminationReach(0);
        mapper.setComputeNormalFromOpacity(false);
      } else {
        const dims = image_.getDimensions();
        const spacing = image_.getSpacing();
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
        sampleDistance /= volumeQuality_ > 1 ? 0.5 * volumeQuality_ ** 2 : 1.0;
        const samplesPerRay = spatialDiagonal / sampleDistance + 1;
        mapper.setMaximumSamplesPerRay(samplesPerRay);
        mapper.setSampleDistance(sampleDistance);
        // Adjust the global illumination reach by volume quality slider
        mapper.setGlobalIlluminationReach(enabled ? 0.25 * volumeQuality_ : 0);
        mapper.setComputeNormalFromOpacity(!enabled && volumeQuality_ > 2);
      }

      requestRender();
    },
    { immediate: true }
  );

  // volume properties
  const ambient = computed(() => cvrParams.value?.ambient ?? 0);
  const diffuse = computed(() => cvrParams.value?.diffuse ?? 0);
  const specular = computed(() => cvrParams.value?.specular ?? 0);

  watch(
    [volume, image, ambient, diffuse, specular, cvrEnabled],
    ([volume_, image_, ambient_, diffuse_, specular_, enabled]) => {
      if (!volume_ || !image_) return;

      const property = volume_.getProperty();
      property.setScalarOpacityUnitDistance(
        0,
        (0.5 * getDiagonalLength(image_.getBounds())) /
          Math.max(...image_.getDimensions())
      );

      property.setShade(true);
      property.setUseGradientOpacity(0, !enabled);
      property.setGradientOpacityMinimumValue(0, 0.0);
      const dataRange = image_.getPointData().getScalars().getRange();
      property.setGradientOpacityMaximumValue(
        0,
        (dataRange[1] - dataRange[0]) * 0.01
      );
      property.setGradientOpacityMinimumOpacity(0, 0.0);
      property.setGradientOpacityMinimumOpacity(0, 1.0);

      // do not toggle these parameters when animating
      property.setAmbient(enabled ? ambient_ : DEFAULT_AMBIENT);
      property.setDiffuse(enabled ? diffuse_ : DEFAULT_DIFFUSE);
      property.setSpecular(enabled ? specular_ : DEFAULT_SPECULAR);

      requestRender();
    },
    { immediate: true }
  );

  // volumetric scattering blending
  const useVolumetricScatteringBlending = computed(
    () => cvrParams.value?.useVolumetricScatteringBlending ?? false
  );
  const volumetricScatteringBlending = computed(
    () => cvrParams.value?.volumetricScatteringBlending ?? 0
  );

  watch(
    [
      useVolumetricScatteringBlending,
      volumetricScatteringBlending,
      repMapper,
      cvrEnabled,
    ],
    ([useVsb, vsb, mapper, enabled]) => {
      if (!mapper) return;

      if (enabled && useVsb) {
        mapper.setVolumetricScatteringBlending(vsb);
      } else {
        mapper.setVolumetricScatteringBlending(0);
      }

      requestRender();
    },
    { immediate: true }
  );

  // local ambient occlusion
  const useLocalAmbientOcclusion = computed(
    () => cvrParams.value?.useLocalAmbientOcclusion ?? false
  );
  const laoKernelSize = computed(() => cvrParams.value?.laoKernelSize ?? 0);
  const laoKernelRadius = computed(() => cvrParams.value?.laoKernelRadius ?? 0);

  watch(
    [
      useLocalAmbientOcclusion,
      laoKernelSize,
      laoKernelRadius,
      repMapper,
      cvrEnabled,
    ],
    ([useLao, kernelSize, kernelRadius, mapper, enabled]) => {
      if (!mapper) return;

      if (enabled && useLao) {
        mapper.setLocalAmbientOcclusion(true);
        mapper.setLAOKernelSize(kernelSize);
        mapper.setLAOKernelRadius(kernelRadius);
      } else {
        mapper.setLocalAmbientOcclusion(false);
        mapper.setLAOKernelSize(0);
        mapper.setLAOKernelRadius(0);
      }

      requestRender();
    },
    { immediate: true }
  );
}

function useColoringEffect(
  config: Ref<Maybe<ColoringConfig>>,
  imageRep: Ref<vtkVolumeRepresentationProxy | null>,
  viewProxy: Ref<vtkLPSView3DProxy>
) {
  const colorBy = computed(() => config.value?.colorBy);
  const colorTransferFunction = computed(() => config.value?.transferFunction);
  const opacityFunction = computed(() => config.value?.opacityFunction);

  const proxyManager = useProxyManager();

  watch(
    [imageRep, colorBy, colorTransferFunction, opacityFunction],
    ([rep, colorBy_, colorFunc, opacityFunc]) => {
      if (!rep || !colorBy_ || !colorFunc || !opacityFunc || !proxyManager) {
        return;
      }

      const { arrayName, location } = colorBy_;

      const lut = proxyManager.getLookupTable(arrayName);
      lut.setMode(LookupTableProxyMode.Preset);
      lut.setPresetName(colorFunc.preset);
      lut.setDataRange(...colorFunc.mappingRange);

      const pwf = proxyManager.getPiecewiseFunction(arrayName);
      pwf.setMode(opacityFunc.mode);
      pwf.setDataRange(...opacityFunc.mappingRange);

      switch (opacityFunc.mode) {
        case vtkPiecewiseFunctionProxy.Mode.Gaussians:
          pwf.setGaussians(opacityFunc.gaussians);
          break;
        case vtkPiecewiseFunctionProxy.Mode.Points: {
          const opacityPoints = getShiftedOpacityFromPreset(
            opacityFunc.preset,
            opacityFunc.mappingRange,
            opacityFunc.shift
          );
          if (opacityPoints) {
            pwf.setPoints(opacityPoints);
          }
          break;
        }
        case vtkPiecewiseFunctionProxy.Mode.Nodes:
          pwf.setNodes(opacityFunc.nodes);
          break;
        default:
      }

      if (rep) {
        // control color range manually
        rep.setRescaleOnColorBy(false);
        rep.setColorBy(arrayName, location);
      }

      // Need to trigger a render for when we are restoring from a state file
      viewProxy.value.renderLater();
    },
    { immediate: true }
  );
}

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
