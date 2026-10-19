<script setup lang="ts">
import { computed, inject, ref, toRefs, watch } from 'vue';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import type { Vector3 } from '@kitware/vtk.js/types';
import { VtkViewContext } from './context';
import { useSliceRepresentation } from '@/src/core/vtk/useSliceRepresentation';
import { scalarWindow } from '@/src/core/vtk/scalarPlane';
import { useVTKMultiWorldToSVG } from '@/src/composables/useVTKWorldToDisplay';
import { onVTKEvent } from '@/src/composables/onVTKEvent';

const props = defineProps<{
  imageData: vtkImageData | null;
  window: { width: number; level: number };
  scalarOffset: number;
}>();
const { imageData } = toRefs(props);
const view = inject(VtkViewContext);
if (!view) throw new Error('No VtkView');
const base = useSliceRepresentation(view, imageData);
base.mapper.setSlicingMode(2);
base.mapper.setSlice(0);
base.mapper.setResolveCoincidentTopologyToPolygonOffset();
base.mapper.setRelativeCoincidentTopologyPolygonOffsetParameters(1, 1);
base.property.setInterpolationTypeToNearest();
watch(
  () => scalarWindow(props.window, props.scalarOffset),
  ({ width, level }) => {
    base.property.setColorWindow(width);
    base.property.setColorLevel(level);
  },
  { immediate: true }
);
const imageRevision = ref(0);
onVTKEvent(imageData, 'onModified', () => {
  imageRevision.value += 1;
  view.requestRender();
});

const corners = useVTKMultiWorldToSVG(
  computed(() => {
    void imageRevision.value;
    const image = imageData.value;
    if (!image) return null;
    return [
      image.indexToWorld([-0.5, -0.5, 0]),
      image.indexToWorld([0.5, -0.5, 0]),
      image.indexToWorld([-0.5, 0.5, 0]),
    ] as Vector3[];
  }),
  view.renderer
);
const imageTransform = computed(() => {
  if (corners.value?.length !== 3) return '';
  const [origin, x, y] = corners.value;
  return `matrix(${x[0] - origin[0]},${x[1] - origin[1]},${y[0] - origin[0]},${y[1] - origin[1]},${origin[0]},${origin[1]})`;
});
</script>

<template>
  <slot :image-transform="imageTransform" />
</template>
