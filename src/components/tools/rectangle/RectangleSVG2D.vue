<template>
  <g>
    <rect
      :x="rectangle.x"
      :y="rectangle.y"
      :width="rectangle.width"
      :height="rectangle.height"
      :stroke="color"
      :stroke-width="strokeWidth"
      :fill="fillColor"
    />
    <circle
      v-if="first"
      :cx="first.x"
      :cy="first.y"
      :stroke="color"
      :stroke-width="strokeWidth"
      fill="transparent"
      :r="ANNOTATION_TOOL_HANDLE_RADIUS"
    />
    <circle
      v-if="second"
      :cx="second.x"
      :cy="second.y"
      :stroke="color"
      :stroke-width="strokeWidth"
      fill="transparent"
      :r="ANNOTATION_TOOL_HANDLE_RADIUS"
    />
  </g>
</template>

<script lang="ts">
import { onVTKEvent } from '@/src/composables/onVTKEvent';
import { ANNOTATION_TOOL_HANDLE_RADIUS } from '@/src/constants';
import { worldToSVG } from '@/src/utils/vtk-helpers';
import type { Vector3 } from '@kitware/vtk.js/types';

import {
  PropType,
  computed,
  defineComponent,
  toRefs,
  unref,
  ref,
  watch,
  inject,
} from 'vue';
import { VtkViewContext } from '@/src/components/vtk/context';
import { vtkFieldRef } from '@/src/core/vtk/vtkFieldRef';
import { useResizeObserver } from '@vueuse/core';

type SVGPoint = {
  x: number;
  y: number;
};

export default defineComponent({
  props: {
    point1: Array as PropType<Array<number>>,
    point2: Array as PropType<Array<number>>,
    color: String,
    fillColor: String,
    strokeWidth: Number,
  },
  setup(props) {
    const { point1, point2 } = toRefs(props);
    const firstPoint = ref<SVGPoint | null>();
    const secondPoint = ref<SVGPoint | null>();

    const view = inject(VtkViewContext);
    if (!view) throw new Error('No VtkView');

    const updatePoints = () => {
      const viewRenderer = view.renderer;
      const pt1 = unref(point1) as Vector3 | undefined;
      const pt2 = unref(point2) as Vector3 | undefined;
      if (pt1) {
        const point2D = worldToSVG(pt1, viewRenderer);
        if (point2D) {
          firstPoint.value = {
            x: point2D[0],
            y: point2D[1],
          };
        }
      } else {
        firstPoint.value = null;
      }

      if (pt2) {
        const point2D = worldToSVG(pt2, viewRenderer);
        if (point2D) {
          secondPoint.value = {
            x: point2D[0],
            y: point2D[1],
          };
        }
      } else {
        secondPoint.value = null;
      }
    };

    const rectangle = computed(() => {
      const [firstX, firstY] = [
        firstPoint.value?.x ?? 0,
        firstPoint.value?.y ?? 0,
      ];
      const [secondX, secondY] = [
        secondPoint.value?.x ?? firstX,
        secondPoint.value?.y ?? firstY,
      ];
      return {
        x: Math.min(firstX, secondX),
        y: Math.min(firstY, secondY),
        width: Math.abs(firstX - secondX),
        height: Math.abs(firstY - secondY),
      };
    });

    const camera = vtkFieldRef(view.renderer, 'activeCamera');
    onVTKEvent(camera, 'onModified', updatePoints);

    watch([point1, point2], updatePoints, {
      deep: true,
      immediate: true,
    });

    // --- resize --- //

    const container = vtkFieldRef(view.renderWindowView, 'container');
    useResizeObserver(container, () => {
      updatePoints();
    });

    return {
      first: firstPoint,
      second: secondPoint,
      rectangle,
      ANNOTATION_TOOL_HANDLE_RADIUS,
    };
  },
});
</script>
