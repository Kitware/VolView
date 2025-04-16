<script setup lang="ts">
import {
  toRefs,
  computed,
  inject,
  watchEffect,
  watch,
  shallowRef,
  Ref,
} from 'vue';
import { useImage } from '@/src/composables/useCurrentImage';
import { useVolumeRepresentation } from '@/src/core/vtk/useVolumeRepresentation';
import { Maybe } from '@/src/types';
import { VtkViewContext } from '@/src/components/vtk/context';
import { useColoringEffect } from '@/src/composables/useColoringEffect';
import useVolumeColoringStore, {
  DEFAULT_AMBIENT,
  DEFAULT_DIFFUSE,
  DEFAULT_SPECULAR,
} from '@/src/store/view-configs/volume-coloring';
import vtkColorTransferFunction from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction';
import vtkPiecewiseFunction from '@kitware/vtk.js/Common/DataModel/PiecewiseFunction';
import { useVolumeColoringInitializer } from '@/src/composables/useVolumeColoringInitializer';
import { isViewAnimating } from '@/src/composables/isViewAnimating';
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
import { useCroppingEffect } from '@/src/composables/useCroppingEffect';
import { useCropStore } from '@/src/store/tools/crop';
import { useEventListener } from '@vueuse/core';
import {
  ChunkImage,
  type ChunkLoadedInfo,
} from '@/src/core/streaming/chunkImage';

interface Props {
  viewId: string;
  imageId: Maybe<string>;
}

const props = defineProps<Props>();
const { viewId: viewID, imageId: imageID } = toRefs(props);

const view = inject(VtkViewContext);
if (!view) throw new Error('No VtkView');

const {
  imageData,
  metadata: imageMetadata,
  isLoading: isImageStreaming,
  image,
} = useImage(imageID);
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

// watch for updated extents
const updatedExtents = shallowRef<Array<ChunkLoadedInfo['updatedExtent']>>([]);
useEventListener(
  // safely assume ChunkImage. If not, the event will never be triggered
  image as Ref<ChunkImage | null>,
  'chunkLoad',
  (info: ChunkLoadedInfo) => {
    updatedExtents.value = [...updatedExtents.value, info.updatedExtent];
  }
);

watch(updatedExtents, (current, old) => {
  const startOffset = old.length;
  rep.mapper.setUpdatedExtents([
    ...rep.mapper.getUpdatedExtents(),
    ...current.slice(startOffset),
  ]);
  view.requestRender();
});

// cinematic volume rendering
const cvrParams = computed(() => coloringConfig.value?.cvr);
const center = computed(() =>
  vtkBoundingBox.getCenter(imageMetadata.value.worldBounds)
);
const isAnimating = isViewAnimating(view);

watchEffect(() => {
  const img = imageData.value;
  if (!cvrParams.value || !img) return;

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

  const enabled = cvrEnabled && !isAnimating.value && !isImageStreaming.value;
  const dataArray = img.getPointData().getScalars();

  setCinematicLighting({
    enabled,
    renderer: view.renderer,
    lightFollowsCamera,
    center: center.value,
  });

  for (let comp = 0; comp < dataArray.getNumberOfComponents(); comp++) {
    setCinematicVolumeShading({
      enabled,
      image: img,
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
    image: img,
    mapper,
    quality: volumeQuality,
  });

  setCinematicLocalAmbientOcclusion({
    enabled: enabled && useLocalAmbientOcclusion,
    kernelRadius: laoKernelRadius,
    kernelSize: laoKernelSize,
    mapper,
  });

  if (isImageStreaming.value) {
    // reduce the quality of the volume until the entire volume is loaded
    const sampleDistance = mapper.getSampleDistance();
    mapper.setSampleDistance(sampleDistance * 15);
  }

  view.requestRender();
});

// apply coloring
useVolumeColoringInitializer(viewID, imageID);

useColoringEffect(coloringConfig, cfun, ofun);

// cropping
const cropStore = useCropStore();
const croppingPlanes = cropStore.getComputedVTKPlanes(imageID);
useCroppingEffect(rep.mapper, croppingPlanes);

defineExpose(rep);
</script>

<template>
  <slot></slot>
</template>
