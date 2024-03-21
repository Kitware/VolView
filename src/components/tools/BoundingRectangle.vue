<script setup lang="ts">
import { computed, ref, watch, toRefs, toRaw, inject } from 'vue';
import { ANNOTATION_TOOL_HANDLE_RADIUS } from '@/src/constants';
import { worldToSVG } from '@/src/utils/vtk-helpers';
import { nonNullable } from '@/src/utils/index';
import vtkBoundingBox from '@kitware/vtk.js/Common/DataModel/BoundingBox';
import type { Bounds, Vector3 } from '@kitware/vtk.js/types';
import { onVTKEvent } from '@/src/composables/onVTKEvent';
import { VtkViewContext } from '@/src/components/vtk/context';
import { vtkFieldRef } from '@/src/core/vtk/vtkFieldRef';
import { useResizeObserver } from '@vueuse/core';

const DEFAULT_PADDING = 2;

const props = withDefaults(
  defineProps<{
    points: Array<Vector3>;
    padding?: number;
  }>(),
  {
    padding: DEFAULT_PADDING,
  }
);

const view = inject(VtkViewContext);
if (!view) throw new Error('No VtkView');

const visible = computed(() => {
  return props.points.length > 0;
});

const rectangle = ref({
  x: 0,
  y: 0,
  width: 0,
  height: 0,
});

const updateRectangle = () => {
  const viewRenderer = view.renderer;

  const screenBounds = [...vtkBoundingBox.INIT_BOUNDS] as Bounds;
  toRaw(props.points)
    .map((point) => {
      const point2D = worldToSVG(point, viewRenderer);
      return point2D;
    })
    .filter(nonNullable)
    .forEach(([x, y]) => {
      vtkBoundingBox.addPoint(screenBounds, x, y, 0);
    });

  vtkBoundingBox.inflate(screenBounds, props.padding);
  const [x, y] = vtkBoundingBox.getMinPoint(screenBounds);
  const [maxX, maxY] = vtkBoundingBox.getMaxPoint(screenBounds);
  // Plus 2 to account for the stroke width
  const handleRadius = ANNOTATION_TOOL_HANDLE_RADIUS + 2;
  const handleDiameter = 2 * handleRadius;
  rectangle.value = {
    x: x - handleRadius,
    y: y - handleRadius,
    width: maxX - x + handleDiameter,
    height: maxY - y + handleDiameter,
  };
};

const { points } = toRefs(props);
watch(points, updateRectangle, { immediate: true, deep: true });

const camera = vtkFieldRef(view.renderer, 'activeCamera');
onVTKEvent(camera, 'onModified', updateRectangle);

const container = vtkFieldRef(view.renderWindowView, 'container');
useResizeObserver(container, () => {
  updateRectangle();
});
</script>

<template>
  <rect
    v-if="visible"
    :x="rectangle.x"
    :y="rectangle.y"
    :width="rectangle.width"
    :height="rectangle.height"
    stroke-width="2"
    fill="transparent"
    stroke="lightgray"
  />
</template>
