<script setup lang="ts">
import { toRefs, watchEffect, inject } from 'vue';
import { useImage } from '@/src/composables/useCurrentImage';
import { useResliceRepresentation } from '@/src/core/vtk/useResliceRepresentation';
import { useWindowingConfig } from '@/src/composables/useWindowingConfig';
import { Maybe } from '@/src/types';
import { VtkViewContext } from '@/src/components/vtk/context';
import { SlabTypes } from '@kitware/vtk.js/Rendering/Core/ImageResliceMapper/Constants';
import type { Vector3 } from '@kitware/vtk.js/types';
import { watchImmediate } from '@vueuse/core';
import vtkPlane from '@kitware/vtk.js/Common/DataModel/Plane';

interface Props {
  viewId: string;
  imageId: Maybe<string>;
  planeNormal: Vector3;
  planeOrigin: Vector3;
}

const props = defineProps<Props>();
const {
  viewId: viewID,
  imageId: imageID,
  planeNormal,
  planeOrigin,
} = toRefs(props);

const view = inject(VtkViewContext);
if (!view) throw new Error('No VtkView');

const { imageData } = useImage(imageID);

// bind window configs
const wlConfig = useWindowingConfig(viewID, imageID);

// setup base image
const sliceRep = useResliceRepresentation(view, imageData);

// set slice ordering to be in the back
sliceRep.mapper.setResolveCoincidentTopologyToPolygonOffset();
sliceRep.mapper.setRelativeCoincidentTopologyPolygonOffsetParameters(1, 1);

// create slicing plane
const slicePlane = vtkPlane.newInstance();
sliceRep.mapper.setSlicePlane(slicePlane);

// initialize visual properties
sliceRep.mapper.setSlabType(SlabTypes.MAX);
sliceRep.mapper.setSlabThickness(1);

// set plane normal
watchImmediate([planeNormal, planeOrigin], ([normal, origin]) => {
  const plane = sliceRep.mapper.getSlicePlane();
  if (!plane) return;
  plane.setNormal(normal);
  plane.setOrigin(origin);
});

// sync windowing
watchEffect(() => {
  sliceRep.property.setColorLevel(wlConfig.level.value);
  sliceRep.property.setColorWindow(wlConfig.width.value);
});

defineExpose(sliceRep);
</script>

<template>
  <slot></slot>
</template>
