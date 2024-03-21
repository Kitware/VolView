<template>
  <g>
    <line
      v-if="first && second"
      :x1="first.x"
      :y1="first.y"
      :x2="second.x"
      :y2="second.y"
      :stroke="color"
      :stroke-width="strokeWidth"
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
      class="handle"
    />
    <text
      v-if="second"
      :x="second.x"
      :y="second.y"
      :dx="textdx"
      :dy="textdy"
      :text-anchor="anchor"
      stroke-width="0.75"
      stroke="black"
      fill="white"
      :font-size="`${textSize}px`"
      font-weight="bold"
    >
      {{ rulerLength }}
    </text>
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
import { useResizeObserver } from '@vueuse/core';
import { vtkFieldRef } from '@/src/core/vtk/vtkFieldRef';

type SVGPoint = {
  x: number;
  y: number;
};

export default defineComponent({
  props: {
    point1: Array as PropType<Array<number>>,
    point2: Array as PropType<Array<number>>,
    color: String,
    strokeWidth: Number,
    length: Number,
    textOffset: {
      type: Number,
      default: 8,
    },
    textSize: {
      type: Number,
      default: 14,
    },
  },
  setup(props) {
    const { point1, point2, textOffset, length } = toRefs(props);
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

    const camera = vtkFieldRef(view.renderer, 'activeCamera');
    onVTKEvent(camera, 'onModified', updatePoints);

    watch([point1, point2], updatePoints, {
      deep: true,
      immediate: true,
    });

    const textProperties = computed(() => {
      const first = unref(firstPoint);
      const second = unref(secondPoint);
      const offset = textOffset.value;
      if (!first || !second) {
        return null;
      }
      if (second.x > first.x) {
        return { dx: offset, dy: -offset, anchor: 'start' };
      }
      return { dx: -offset, dy: -offset, anchor: 'end' };
    });

    // --- resize --- //

    const container = vtkFieldRef(view.renderWindowView, 'container');
    useResizeObserver(container, () => {
      updatePoints();
    });

    return {
      textdx: computed(() => textProperties.value?.dx ?? 0),
      textdy: computed(() => textProperties.value?.dy ?? 0),
      anchor: computed(() => textProperties.value?.anchor ?? 'start'),
      first: firstPoint,
      second: secondPoint,
      rulerLength: computed(() => length?.value?.toFixed(2) ?? ''),
      ANNOTATION_TOOL_HANDLE_RADIUS,
    };
  },
});
</script>

<style scoped>
.handle {
  cursor: pointer;
}
</style>
