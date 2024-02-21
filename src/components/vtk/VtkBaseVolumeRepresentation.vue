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
} from '@/src/store/view-configs/volume-coloring';
import vtkColorTransferFunction from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction';
import vtkPiecewiseFunction from '@kitware/vtk.js/Common/DataModel/PiecewiseFunction';
import { useVolumeColoringInitializer } from '@/src/composables/useVolumeColoringInitializer';
import { isViewAnimatingNew as isViewAnimating } from '@/src/composables/isViewAnimating';
import { InterpolationType } from '@kitware/vtk.js/Rendering/Core/VolumeProperty/Constants';
import {
  setCinematicLighting,
  setCinematicLocalAmbientOcclusion,
  setCinematicVolumeSampling,
  setCinematicVolumeScatter,
  setCinematicVolumeShading,
} from '@/src/utils/volumeProperties';
import vtkBoundingBox from '@kitware/vtk.js/Common/DataModel/BoundingBox';
import type { vtkObject } from '@kitware/vtk.js/interfaces';
import { onVTKEvent } from '@/src/composables/onVTKEvent';

interface Props {
  viewId: string;
  imageId: Maybe<string>;
}

const props = defineProps<Props>();
const { viewId: viewID, imageId: imageID } = toRefs(props);

const view = inject(VtkViewContext);
if (!view) throw new Error('No VtkView');

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
    enabled: cvrEnabled,
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

  const enabled = cvrEnabled && !isAnimating.value;
  const dataArray = image.getPointData().getScalars();

  setCinematicLighting({
    enabled,
    renderer: view.renderer,
    lightFollowsCamera,
    center: center.value,
  });

  for (let comp = 0; comp < dataArray.getNumberOfComponents(); comp++) {
    setCinematicVolumeShading({
      enabled,
      image,
      ambient,
      diffuse,
      specular,
      property,
      component: comp,
    });
  }

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
