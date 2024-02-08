import { isViewAnimating } from '@/src/composables/isViewAnimating';
import { VolumeColorConfig } from '@/src/store/view-configs/types';
import {
  DEFAULT_AMBIENT,
  DEFAULT_DIFFUSE,
  DEFAULT_SPECULAR,
} from '@/src/store/view-configs/volume-coloring';
import { Maybe } from '@/src/types';
import vtkLPSView3DProxy from '@/src/vtk/LPSView3DProxy';
import { getDiagonalLength } from '@kitware/vtk.js/Common/DataModel/BoundingBox';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkVolumeRepresentationProxy from '@kitware/vtk.js/Proxy/Representations/VolumeRepresentationProxy';
import vtkVolumeMapper from '@kitware/vtk.js/Rendering/Core/VolumeMapper';
import { Vector3 } from '@kitware/vtk.js/types';
import { vec3 } from 'gl-matrix';
import { Ref, computed, watch } from 'vue';

export function useCvrEffect(
  config: Ref<Maybe<VolumeColorConfig>>,
  imageRep: Ref<Maybe<vtkVolumeRepresentationProxy>>,
  viewProxy: Ref<vtkLPSView3DProxy>
) {
  const cvrParams = computed(() => config.value?.cvr);
  const repMapper = computed(
    () => imageRep.value?.getMapper() as Maybe<vtkVolumeMapper>
  );
  const image = computed(
    () => imageRep.value?.getInputDataSet() as Maybe<vtkImageData>
  );
  const volume = computed(() => imageRep.value?.getVolumes()[0]);
  const renderer = computed(() => viewProxy.value.getRenderer());
  const isAnimating = isViewAnimating(viewProxy);
  const cvrEnabled = computed(() => {
    const enabled = !!cvrParams.value?.enabled;
    const animating = isAnimating.value;
    return enabled && !animating;
  });

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

      viewProxy.value.renderLater();
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

      viewProxy.value.renderLater();
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
      property.setGradientOpacityMaximumOpacity(0, 1.0);

      // do not toggle these parameters when animating
      property.setAmbient(enabled ? ambient_ : DEFAULT_AMBIENT);
      property.setDiffuse(enabled ? diffuse_ : DEFAULT_DIFFUSE);
      property.setSpecular(enabled ? specular_ : DEFAULT_SPECULAR);

      viewProxy.value.renderLater();
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

      viewProxy.value.renderLater();
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

      viewProxy.value.renderLater();
    },
    { immediate: true }
  );
}
