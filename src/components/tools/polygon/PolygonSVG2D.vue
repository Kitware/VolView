<template>
  <g>
    <circle
      v-for="({ point: [x, y], radius }, index) in handlePoints"
      :key="index"
      :cx="x"
      :cy="y"
      :stroke="color"
      :stroke-width="strokeWidth"
      fill="transparent"
      :r="radius"
    />
    <polyline
      :points="linePoints"
      :stroke="color"
      :stroke-width="strokeWidth"
      fill="none"
    />
  </g>
</template>

<script lang="ts">
import { onVTKEvent } from '@/src/composables/onVTKEvent';
import { ANNOTATION_TOOL_HANDLE_RADIUS } from '@/src/constants';
import { worldToSVG } from '@/src/utils/vtk-helpers';
import type { Vector2, Vector3 } from '@kitware/vtk.js/types';
import { PropType, defineComponent, toRefs, ref, watch, inject } from 'vue';
import { Maybe } from '@/src/types';
import { VtkViewContext } from '@/src/components/vtk/context';
import { useResizeObserver } from '@vueuse/core';
import { vtkFieldRef } from '@/src/core/vtk/vtkFieldRef';

const POINT_RADIUS = ANNOTATION_TOOL_HANDLE_RADIUS;
const FINISHABLE_POINT_RADIUS = POINT_RADIUS + 6;

export default defineComponent({
  props: {
    points: {
      type: Array as PropType<Array<Vector3>>,
      required: true,
    },
    color: String,
    strokeWidth: Number,
    movePoint: {
      type: Array as unknown as PropType<Maybe<Vector3>>,
    },
    placing: {
      type: Boolean,
      default: false,
    },
    finishable: {
      type: Boolean,
      default: false,
    },
  },
  setup(props) {
    const { points, movePoint, placing, finishable } = toRefs(props);

    const view = inject(VtkViewContext);
    if (!view) throw new Error('No VtkView');

    type SVGPoint = { point: Vector2; radius: number };
    const handlePoints = ref<Array<SVGPoint>>([]);
    const linePoints = ref<string>('');

    const updatePoints = () => {
      const viewRenderer = view.renderer;
      const svgPoints = points.value.map((point) => {
        const point2D = worldToSVG(point, viewRenderer);
        return {
          point: point2D ?? ([0, 0] as Vector2),
          radius: POINT_RADIUS,
        };
      });

      // Indicate finishable
      if (svgPoints.length > 0 && finishable.value && placing.value) {
        svgPoints[0].radius = FINISHABLE_POINT_RADIUS;
      }

      // Show point under mouse if one point placed
      if (svgPoints.length > 0 && placing.value && movePoint.value) {
        const moveHandlePoint =
          worldToSVG(movePoint.value, viewRenderer) ?? ([0, 0] as Vector2);
        svgPoints.push({
          point: moveHandlePoint,
          radius: POINT_RADIUS,
        });
      }

      handlePoints.value = svgPoints;

      const lines = handlePoints.value.map(({ point }) => point?.join(','));
      if (!placing.value) {
        // Close the polygon
        lines.push(lines[0]);
      }
      linePoints.value = lines.join(' ');
    };

    const camera = vtkFieldRef(view.renderer, 'activeCamera');
    onVTKEvent(camera, 'onModified', updatePoints);

    watch([points, movePoint, placing], updatePoints, {
      deep: true,
      immediate: true,
    });

    // --- resize --- //

    const container = vtkFieldRef(view.renderWindowView, 'container');
    useResizeObserver(container, () => {
      updatePoints();
    });

    return {
      devicePixelRatio,
      handlePoints,
      linePoints,
    };
  },
});
</script>
