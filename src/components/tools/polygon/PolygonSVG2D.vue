<template>
  <g>
    <!-- radius should match constants.ANNOTATION_TOOL_HANDLE_RADIUS and should be related to vtkHandleWidget scale. -->
    <circle
      v-for="({ point: [x, y], radius }, index) in handlePoints"
      :key="index"
      :cx="x"
      :cy="y"
      :stroke="color"
      :stroke-width="strokeWidth"
      fill="transparent"
      :r="radius / devicePixelRatio"
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
import { useResizeObserver } from '@/src/composables/useResizeObserver';
import { onVTKEvent } from '@/src/composables/onVTKEvent';
import { ANNOTATION_TOOL_HANDLE_RADIUS, ToolContainer } from '@/src/constants';
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
import { Maybe } from '@/src/types';

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
    viewId: {
      type: String,
      required: true,
    },
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
          radius: POINT_RADIUS,
        };
      });

      // Indicate finishable
      if (finishable.value && placing.value) {
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

    const camera = computed(() => viewProxy.value.getCamera());
    onVTKEvent(camera, 'onModified', updatePoints);

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
