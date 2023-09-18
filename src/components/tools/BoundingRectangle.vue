<script setup lang="ts">
import { computed, ref, watch, toRefs } from 'vue';
import { ANNOTATION_TOOL_HANDLE_RADIUS } from '@/src/constants';
import { useViewStore } from '@/src/store/views';
import { worldToSVG } from '@/src/utils/vtk-helpers';
import { nonNullable } from '@/src/utils/index';
import vtkLPSView2DProxy from '@/src/vtk/LPSView2DProxy';
import vtkBoundingBox from '@kitware/vtk.js/Common/DataModel/BoundingBox';
import { Bounds, Vector3 } from '@kitware/vtk.js/types';
import { onVTKEvent } from '@/src/composables/onVTKEvent';

const props = defineProps<{
  points: Array<Vector3>;
  viewId: string;
}>();

const viewStore = useViewStore();
const viewProxy = computed(
  () => viewStore.getViewProxy<vtkLPSView2DProxy>(props.viewId)!
);

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
  const viewRenderer = viewProxy.value.getRenderer();

  const screenBounds = [...vtkBoundingBox.INIT_BOUNDS] as Bounds;
  props.points
    .map((point) => {
      const point2D = worldToSVG(point, viewRenderer);
      return point2D;
    })
    .filter(nonNullable)
    .forEach(([x, y]) => {
      vtkBoundingBox.addPoint(screenBounds, x, y, 0);
    });
  const [x, y] = vtkBoundingBox.getMinPoint(screenBounds);
  const [maxX, maxY] = vtkBoundingBox.getMaxPoint(screenBounds);
  // Plus 2 to account for the stroke width
  const handleRadius = (ANNOTATION_TOOL_HANDLE_RADIUS + 2) / devicePixelRatio;
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

onVTKEvent(viewProxy, 'onModified', updateRectangle);
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
