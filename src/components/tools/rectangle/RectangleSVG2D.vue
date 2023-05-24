<template>
  <g ref="containerEl">
    <rect
      :x="rectangle.x"
      :y="rectangle.y"
      :width="rectangle.width"
      :height="rectangle.height"
      :stroke="color"
      stroke-width="1"
      fill="transparent"
    />
    <!-- radius is related to the vtkRectangleWidget scale, specified in state -->
    <circle
      v-if="first"
      :cx="first.x"
      :cy="first.y"
      :stroke="color"
      stroke-width="1"
      fill="transparent"
      :r="10 / devicePixelRatio"
    />
    <circle
      v-if="second"
      :cx="second.x"
      :cy="second.y"
      :stroke="color"
      stroke-width="1"
      fill="transparent"
      :r="10 / devicePixelRatio"
    />
  </g>
</template>

<script lang="ts">
import { useResizeObserver } from '@/src/composables/useResizeObserver';
import { useVTKCallback } from '@/src/composables/useVTKCallback';
import { useViewStore } from '@/src/store/views';
import { worldToSVG } from '@/src/utils/vtk-helpers';
import vtkLPSView2DProxy from '@/src/vtk/LPSView2DProxy';
import { Vector3 } from '@kitware/vtk.js/types';
import {
  PropType,
  computed,
  defineComponent,
  toRefs,
  unref,
  ref,
  watch,
} from 'vue';

type SVGPoint = {
  x: number;
  y: number;
};

export default defineComponent({
  props: {
    point1: Array as PropType<Array<number>>,
    point2: Array as PropType<Array<number>>,
    color: String,
    viewId: {
      type: String,
      required: true,
    },
  },
  setup(props) {
    const { viewId: viewID, point1, point2 } = toRefs(props);
    const firstPoint = ref<SVGPoint | null>();
    const secondPoint = ref<SVGPoint | null>();

    const viewStore = useViewStore();

    const viewProxy = computed(
      () => viewStore.getViewProxy<vtkLPSView2DProxy>(viewID.value)!
    );

    const updatePoints = () => {
      const viewRenderer = viewProxy.value.getRenderer();
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

    const cameraOnModified = useVTKCallback(
      computed(() => viewProxy.value.getCamera().onModified)
    );
    cameraOnModified(updatePoints);

    watch([viewProxy, point1, point2], updatePoints, {
      deep: true,
      immediate: true,
    });

    // --- resize --- //

    const containerEl = ref<Element | null>(null);

    useResizeObserver(containerEl, () => {
      updatePoints();
    });

    return {
      devicePixelRatio,
      first: firstPoint,
      second: secondPoint,
      rectangle,
      containerEl,
    };
  },
});
</script>
