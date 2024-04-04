<script setup lang="ts">
import { VtkViewContext } from '@/src/components/vtk/context';
import { useImage } from '@/src/composables/useCurrentImage';
import { useVtkFilter } from '@/src/core/vtk/useVtkFilter';
import { useVtkRepresentation } from '@/src/core/vtk/useVtkRepresentation';
import { vtkFieldRef } from '@/src/core/vtk/vtkFieldRef';
import { Maybe } from '@/src/types';
import vtkPlane from '@kitware/vtk.js/Common/DataModel/Plane';
import vtkPolyData from '@kitware/vtk.js/Common/DataModel/PolyData';
import vtkCutter from '@kitware/vtk.js/Filters/Core/Cutter';
import vtkImageDataOutlineFilter from '@kitware/vtk.js/Filters/General/ImageDataOutlineFilter';
import vtkActor from '@kitware/vtk.js/Rendering/Core/Actor';
import vtkMapper from '@kitware/vtk.js/Rendering/Core/Mapper';
import type { Vector3 } from '@kitware/vtk.js/types';
import { syncRefs, watchImmediate } from '@vueuse/core';
import { inject, toRefs, watchEffect } from 'vue';

interface Props {
  viewId: string;
  imageId: Maybe<string>;
  planeNormal: Vector3;
  planeOrigin: Vector3;
  color?: Vector3;
  thickness?: number;
}

const props = withDefaults(defineProps<Props>(), {
  thickness: 1,
  color: () => [1, 1, 1] as Vector3,
});
const { imageId, planeNormal, planeOrigin, color, thickness } = toRefs(props);

const view = inject(VtkViewContext);
if (!view) throw new Error('No VtkView');

// outline filter
const { imageData } = useImage(imageId);
const outlineFilter = useVtkFilter(vtkImageDataOutlineFilter, imageData);
const outline = outlineFilter.getOutputData<vtkPolyData>(0);

// slicing plane
const slicePlane = vtkPlane.newInstance();
const cutterFilter = useVtkFilter(vtkCutter, outline);
(cutterFilter.filter as any).setCutFunction(slicePlane);

// representation
const rep = useVtkRepresentation({
  view,
  data: cutterFilter.getOutputData(0),
  vtkActorClass: vtkActor,
  vtkMapperClass: vtkMapper,
});

// set representation properties
watchEffect(() => {
  rep.property.setLineWidth(thickness.value);
  rep.property.setColor(color.value);
});

// sync input plane to slice plane
const slicePlaneNormal = vtkFieldRef(slicePlane, 'normal');
const slicePlaneOrigin = vtkFieldRef(slicePlane, 'origin');
syncRefs(planeNormal, slicePlaneNormal);
syncRefs(planeOrigin, slicePlaneOrigin);

// update filter
watchImmediate([slicePlaneNormal, slicePlaneOrigin], () => {
  cutterFilter.filter.modified();
});

defineExpose(rep);
</script>

<template><slot></slot></template>
