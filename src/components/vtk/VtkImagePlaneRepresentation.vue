<script setup lang="ts">
import { computed, inject, onScopeDispose, ref, toRefs, watch } from 'vue';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import type { Vector3 } from '@kitware/vtk.js/types';
import { VtkViewContext } from './context';
import { useSliceRepresentation } from '@/src/core/vtk/useSliceRepresentation';
import { scalarWindow, type ScalarTransform } from '@/src/core/vtk/scalarPlane';
import { useVTKMultiWorldToSVG } from '@/src/composables/useVTKWorldToDisplay';
import { onVTKEvent } from '@/src/composables/onVTKEvent';

const props = defineProps<{
  imageData: vtkImageData | null;
  window: { width: number; level: number };
  scalarTransform: ScalarTransform;
  overlayPixels: Uint8Array | null;
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
  () => scalarWindow(props.window, props.scalarTransform),
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

const overlayImage = vtkImageData.newInstance();
const overlayScalars = vtkDataArray.newInstance({
  numberOfComponents: 4,
  values: new Uint8Array(4),
});
overlayImage.getPointData().setScalars(overlayScalars);
const overlay = useSliceRepresentation(
  view,
  computed(() => (props.imageData && props.overlayPixels ? overlayImage : null))
);
overlay.mapper.setSlicingMode(2);
overlay.mapper.setSlice(0);
overlay.mapper.setResolveCoincidentTopologyToPolygonOffset();
overlay.mapper.setRelativeCoincidentTopologyPolygonOffsetParameters(0, 0);
overlay.actor.setPickable(false);
overlay.property.setIndependentComponents(false);
overlay.property.setColorWindow(255);
overlay.property.setColorLevel(127.5);
overlay.property.setInterpolationTypeToNearest();
watch(
  [imageData, imageRevision],
  ([image]) => {
    if (!image) return;
    overlayImage.setDimensions(image.getDimensions());
    overlayImage.setSpacing(image.getSpacing());
    overlayImage.setOrigin(image.getOrigin());
    overlayImage.setDirection(image.getDirection());
  },
  { immediate: true }
);
watch(
  () => props.overlayPixels,
  (pixels) => {
    if (!pixels) return;
    overlayScalars.setData(pixels, 4);
    overlayImage.modified();
    view.requestRender();
  },
  { immediate: true }
);
onScopeDispose(() => {
  overlayImage.delete();
  overlayScalars.delete();
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
