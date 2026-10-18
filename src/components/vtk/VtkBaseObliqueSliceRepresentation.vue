<script setup lang="ts">
import { nativeColorWindow } from '@/src/utils/nativeColorWindow';
import { computed, toRefs, watchEffect, inject, onScopeDispose } from 'vue';
import { useImage } from '@/src/composables/useCurrentImage';
import { useResliceRepresentation } from '@/src/core/vtk/useResliceRepresentation';
import { useBaseSliceColoring } from '@/src/composables/useBaseSliceColoring';
import { isCineImage } from '@/src/core/cine/isCineImage';
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
const components = computed(
  () =>
    imageData.value?.getPointData().getScalars()?.getNumberOfComponents() ?? 0
);
const renderInput = computed(() =>
  components.value >= 1 && components.value <= 4 ? imageData.value : undefined
);
const sliceRep = useResliceRepresentation(view, renderInput);
watchEffect(() => {
  sliceRep.actor.setVisibility(wlConfig.config.value?.visibility ?? true);
});
useBaseSliceColoring(
  sliceRep.property,
  computed(() => wlConfig.config.value?.preset),
  computed(
    () =>
      !!imageID.value && !isCineImage(imageID.value) && components.value === 1
  ),
  view.requestRender
);

// set slice ordering to be in the back
sliceRep.mapper.setResolveCoincidentTopologyToPolygonOffset();
sliceRep.mapper.setRelativeCoincidentTopologyPolygonOffsetParameters(1, 1);

// create slicing plane
const slicePlane = vtkPlane.newInstance();
onScopeDispose(() => slicePlane.delete());
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
  const cine = !!imageID.value && isCineImage(imageID.value);
  sliceRep.property.setIndependentComponents(false);
  if (components.value > 1 || cine) {
    const { width, level } = nativeColorWindow(
      cine
        ? 'Uint8Array'
        : imageData.value?.getPointData().getScalars()?.getDataType()
    );
    sliceRep.property.setColorLevel(level);
    sliceRep.property.setColorWindow(width);
  } else {
    sliceRep.property.setColorLevel(wlConfig.level.value);
    sliceRep.property.setColorWindow(wlConfig.width.value);
  }
});

defineExpose(sliceRep);
</script>

<template>
  <slot></slot>
</template>
