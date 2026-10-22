<script setup lang="ts">
import { computed, toRefs, watchEffect, inject, onScopeDispose } from 'vue';
import { nativeColorWindow } from '@/src/utils/nativeColorWindow';
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

type Props = {
  viewId: string;
  imageId: Maybe<string>;
  planeNormal: Vector3;
  planeOrigin: Vector3;
};

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

const sliceRep = useResliceRepresentation(
  { ...view, renderer: view.imageRenderer },
  imageData
);

watchImmediate(
  [() => wlConfig.config.value?.visibility ?? true, imageData],
  ([visible, image]) => {
    sliceRep.actor.setVisibility(visible);
    if (visible && image) {
      // Hidden image actors are excluded when a layout resize fits clipping.
      view.renderer.resetCameraClippingRange(image.getBounds());
    }
  }
);

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
watchEffect(() => {
  const plane = sliceRep.mapper.getSlicePlane();
  if (!plane) return;
  plane.setNormal(planeNormal.value);
  plane.setOrigin(planeOrigin.value);
});

// sync windowing
watchEffect(() => {
  const cine = !!imageID.value && isCineImage(imageID.value);
  if (components.value === 3 || components.value === 4 || cine) {
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
