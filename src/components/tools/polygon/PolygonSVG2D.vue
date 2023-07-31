<template>
  <g>
    <!-- radius is related to the vtkRectangleWidget scale, specified in state -->
    <circle
      v-for="({ point: [x, y], radius }, index) in handlePoints"
      :key="index"
      :cx="x"
      :cy="y"
      :stroke="color"
      stroke-width="1"
      fill="transparent"
      :r="radius"
    />
    <polyline
      :points="linePoints"
      :stroke="color"
      stroke-width="1"
      fill="none"
    />
  </g>
</template>

<script lang="ts">
import { useResizeObserver } from '@/src/composables/useResizeObserver';
import { useVTKCallback } from '@/src/composables/useVTKCallback';
import { ToolContainer } from '@/src/constants';
import { useViewStore } from '@/src/store/views';
import { worldToSVG } from '@/src/utils/vtk-helpers';
import vtkLPSView2DProxy from '@/src/vtk/LPSView2DProxy';
import type { Vector2, Vector3 } from '@kitware/vtk.js/types';
import {
  PropType,
  computed,
  defineComponent,
  toRefs,
  ref,
  watch,
  inject,
} from 'vue';

const POINT_RADIUS = 4;
const FINISHABLE_POINT_RADIUS = 8;
const MOVE_POINT_RADIUS = 2;

export default defineComponent({
  props: {
    points: {
      type: Array as PropType<Array<Vector3>>,
      required: true,
    },
    color: String,
    viewId: {
      type: String,
      required: true,
    },
    movePoint: {
      type: Array as unknown as PropType<Vector3>,
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
    const {
      viewId: viewID,
      points,
      movePoint,
      placing,
      finishable,
    } = toRefs(props);

    const viewStore = useViewStore();
    const viewProxy = computed(
      () => viewStore.getViewProxy<vtkLPSView2DProxy>(viewID.value)!
    );

    type SVGPoint = { point: Vector2; radius: number };
    const handlePoints = ref<Array<SVGPoint>>([]);
    const linePoints = ref<string>('');

    const updatePoints = () => {
      const viewRenderer = viewProxy.value.getRenderer();
      const svgPoints = points.value.map((point) => {
        const point2D = worldToSVG(point, viewRenderer);
        return {
          point: point2D ?? ([0, 0] as Vector2),
          radius: POINT_RADIUS / devicePixelRatio,
        };
      });

      // Indicate finishable
      if (finishable.value && placing.value) {
        svgPoints[0].radius = FINISHABLE_POINT_RADIUS / devicePixelRatio;
      }

      // Show point under mouse if one point placed
      if (svgPoints.length > 0 && placing.value && movePoint.value) {
        const moveHandlePoint =
          worldToSVG(movePoint.value, viewRenderer) ?? ([0, 0] as Vector2);
        svgPoints.push({
          point: moveHandlePoint,
          radius: MOVE_POINT_RADIUS,
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

    const cameraOnModified = useVTKCallback(
      computed(() => viewProxy.value.getCamera().onModified)
    );
    cameraOnModified(updatePoints);

    watch([viewProxy, points, movePoint, placing], updatePoints, {
      deep: true,
      immediate: true,
    });

    // --- resize --- //

    const containerEl = inject(ToolContainer)!;

    useResizeObserver(containerEl, () => {
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