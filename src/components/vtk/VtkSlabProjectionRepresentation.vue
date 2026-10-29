<script setup lang="ts">
import { computed, inject, onScopeDispose, watchEffect } from 'vue';
import type vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkPlane from '@kitware/vtk.js/Common/DataModel/Plane';
import vtkPiecewiseFunction from '@kitware/vtk.js/Common/DataModel/PiecewiseFunction';
import { SlabTypes } from '@kitware/vtk.js/Rendering/Core/ImageResliceMapper/Constants';
import type { Vector3 } from '@kitware/vtk.js/types';
import { vec3 } from 'gl-matrix';
import { VtkRenderWindowParentContext, VtkViewContext } from './context';
import { useResliceRepresentation } from '@/src/core/vtk/useResliceRepresentation';
import { useVTKMultiWorldToSVG } from '@/src/composables/useVTKWorldToDisplay';
import { useWebGLWatchdog } from '@/src/composables/useWebGLWatchdog';
import { useBaseSliceColoring } from '@/src/composables/useBaseSliceColoring';
import { Messages } from '@/src/constants';
import { deriveSlabGeometry } from '@/src/core/slab/geometry';
import type { SlabSpecification } from '@/src/core/slab/types';

const props = defineProps<{
  imageData: vtkImageData | null | undefined;
  specification: SlabSpecification;
  window: {
    width: number;
    level: number;
    preset?: string;
    visibility?: boolean;
  };
}>();
const emit = defineEmits<{
  error: [message: string];
}>();
const view = inject(VtkViewContext);
if (!view) throw new Error('No VtkView');
const parent = inject(VtkRenderWindowParentContext, null);
const contextLost = parent?.contextLost ?? useWebGLWatchdog(view);
const imageData = computed(() => (!contextLost.value ? props.imageData : null));
const representation = useResliceRepresentation(
  { ...view, renderer: view.imageRenderer },
  imageData
);
const { actor, mapper, property } = representation;
const slicePlane = vtkPlane.newInstance();
const opacity = vtkPiecewiseFunction.newInstance();
opacity.addPoint(0, 1);
opacity.addPoint(1, 1);
property.setPiecewiseFunction(0, opacity);
useBaseSliceColoring(
  property,
  computed(() => props.window.preset),
  true,
  view.requestRender
);
mapper.setSlicePlane(slicePlane);
mapper.setResolveCoincidentTopologyToPolygonOffset();
mapper.setRelativeCoincidentTopologyPolygonOffsetParameters(1, 1);
const geometry = computed(() =>
  props.imageData
    ? deriveSlabGeometry(props.imageData, props.specification)
    : null
);
watchEffect(() => {
  const { specification, window } = props;
  actor.setVisibility(window.visibility ?? true);
  if (contextLost.value) {
    mapper.setInputData(null);
    // Pending parent renders must not copy a failed framebuffer into this pane.
    if (parent) view.renderWindowView.initialize();
    view.renderWindowView.setContext2D(null);
    const canvas = view.renderWindowView.getCanvas();
    if (canvas) {
      canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    }
    emit('error', Messages.WebGLLost.details);
    return;
  }
  const current = geometry.value;
  if (!current) return;
  slicePlane.setNormal(current.planeNormal);
  slicePlane.setOrigin(current.planeOrigin);
  mapper.setSlabThickness(current.slabThickness);
  mapper.setSlabType(
    { mean: SlabTypes.MEAN, max: SlabTypes.MAX, sum: SlabTypes.SUM }[
      specification.method
    ]
  );
  property.setColorWindow(window.width);
  property.setColorLevel(window.level);
  view.requestRender();
});
onScopeDispose(() => {
  slicePlane.delete();
  opacity.delete();
});
const corners = useVTKMultiWorldToSVG(
  computed(() => {
    if (!geometry.value) return null;
    const { pixelToWorld } = geometry.value;
    return (
      [
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
      ] as Vector3[]
    ).map(
      (point) => vec3.transformMat4([0, 0, 0], point, pixelToWorld) as Vector3
    );
  }),
  view.renderer
);
const imageMatrix = computed(() => {
  if (corners.value?.length !== 3) return undefined;
  const [origin, x, y] = corners.value;
  return [
    x[0] - origin[0],
    x[1] - origin[1],
    y[0] - origin[0],
    y[1] - origin[1],
    origin[0],
    origin[1],
  ] satisfies [number, number, number, number, number, number];
});
defineExpose(representation);
</script>

<template>
  <slot :image-matrix="imageMatrix" />
</template>
