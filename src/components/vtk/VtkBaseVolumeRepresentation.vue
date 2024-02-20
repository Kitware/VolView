<script setup lang="ts">
import { toRefs, computed, inject, watchEffect } from 'vue';
import { useImage } from '@/src/composables/useCurrentImage';
import { useVolumeRepresentation } from '@/src/core/vtk/useVolumeRepresentation';
import { Maybe } from '@/src/types';
import { VtkViewContext } from '@/src/components/vtk/context';
import { useColoringEffect } from '@/src/composables/useColoringEffectNew';
import useVolumeColoringStore, {
  DEFAULT_AMBIENT,
  DEFAULT_DIFFUSE,
  DEFAULT_SPECULAR,
  DEFAULT_EDGE_GRADIENT,
  DEFAULT_SAMPLING_DISTANCE,
} from '@/src/store/view-configs/volume-coloring';
import vtkColorTransferFunction from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction';
import vtkPiecewiseFunction from '@kitware/vtk.js/Common/DataModel/PiecewiseFunction';
import { useVolumeColoringInitializer } from '@/src/composables/useVolumeColoringInitializer';
import { isViewAnimatingNew as isViewAnimating } from '@/src/composables/isViewAnimating';
import { InterpolationType } from '@kitware/vtk.js/Rendering/Core/VolumeProperty/Constants';
import {
  setEdgeGradient,
  setSamplingDistance,
  setCinematicLighting,
  setCinematicLocalAmbientOcclusion,
  setCinematicVolumeSampling,
  setCinematicVolumeScatter,
  setCinematicVolumeShading,
} from '@/src/utils/volumeProperties';
import vtkBoundingBox from '@kitware/vtk.js/Common/DataModel/BoundingBox';
import { vtkObject } from '@kitware/vtk.js/interfaces';
import { onVTKEvent } from '@/src/composables/onVTKEvent';
import { useViewAnimationListener } from '@/src/composables/useViewAnimationListener';

interface Props {
  viewId: string;
  viewType: string;
  imageId: Maybe<string>;
}

const props = defineProps<Props>();
const { viewId: viewID, imageId: imageID, viewType } = toRefs(props);

const view = inject(VtkViewContext);
if (!view) throw new Error('No VtkView');

useViewAnimationListener(view, viewID, viewType);

const { imageData, metadata: imageMetadata } = useImage(imageID);
const coloringConfig = computed(() =>
  useVolumeColoringStore().getConfig(viewID.value, imageID.value)
);

// setup base image
const rep = useVolumeRepresentation(view, imageData);

const cfun = vtkColorTransferFunction.newInstance();
const ofun = vtkPiecewiseFunction.newInstance();
rep.property.setRGBTransferFunction(0, cfun);
rep.property.setScalarOpacity(0, ofun);
rep.property.setShade(true);
rep.property.setInterpolationType(InterpolationType.LINEAR);
rep.property.setAmbient(DEFAULT_AMBIENT);
rep.property.setDiffuse(DEFAULT_DIFFUSE);
rep.property.setSpecular(DEFAULT_SPECULAR);

[cfun, ofun].forEach((obj: vtkObject) => {
  onVTKEvent(obj, 'onModified', view.requestRender);
});

// set initial edge gradient + sampling distance
watchEffect(() => {
  if (!imageData.value) return;
  const dataArray = imageData.value.getPointData().getScalars();
  setEdgeGradient(rep.property, DEFAULT_EDGE_GRADIENT, dataArray);
  setSamplingDistance(rep.mapper, DEFAULT_SAMPLING_DISTANCE, imageData.value);
});

// cinematic volume rendering
const cvrParams = computed(() => coloringConfig.value?.cvr);
const center = computed(() =>
  vtkBoundingBox.getCenter(imageMetadata.value.worldBounds)
);
const isAnimating = isViewAnimating(view);

watchEffect(() => {
  const image = imageData.value;
  if (!cvrParams.value || !image) return;

  const {
    enabled,
    lightFollowsCamera,
    ambient,
    diffuse,
    specular,
    volumetricScatteringBlending,
    volumeQuality,
    useLocalAmbientOcclusion,
    useVolumetricScatteringBlending,
    laoKernelRadius,
    laoKernelSize,
  } = cvrParams.value;
  const { property, mapper } = rep;

  setCinematicLighting({
    enabled,
    renderer: view.renderer,
    lightFollowsCamera,
    center: center.value,
  });
  setCinematicVolumeShading({
    enabled,
    image,
    ambient,
    diffuse,
    specular,
    property,
  });
  setCinematicVolumeScatter({
    enabled: enabled && useVolumetricScatteringBlending,
    mapper,
    blending: volumetricScatteringBlending,
  });
  setCinematicVolumeSampling({
    enabled,
    image,
    mapper,
    quality: volumeQuality,
    isAnimating: isAnimating.value,
  });
  setCinematicLocalAmbientOcclusion({
    enabled: enabled && useLocalAmbientOcclusion,
    kernelRadius: laoKernelRadius,
    kernelSize: laoKernelSize,
    mapper,
  });

  view.requestRender();
});

// apply coloring
useVolumeColoringInitializer(viewID, imageID);

useColoringEffect(coloringConfig, cfun, ofun);
</script>

<template>
  <slot></slot>
</template>
