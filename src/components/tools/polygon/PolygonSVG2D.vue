<template>
  <g>
    <!-- radius is related to the vtkRectangleWidget scale, specified in state -->
    <circle
      v-for="([x, y], index) in handlePoints"
      :key="index"
      :cx="x"
      :cy="y"
      :stroke="color"
      stroke-width="1"
      fill="transparent"
      :r="10 / devicePixelRatio"
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
import { manageVTKSubscription } from '@/src/composables/manageVTKSubscription';
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
      required: true,
    },
    placing: {
      type: Boolean,
      default: false,
    },
  },
  setup(props) {
    const { viewId: viewID, points, movePoint, placing } = toRefs(props);

    const viewStore = useViewStore();
    const viewProxy = computed(
      () => viewStore.getViewProxy<vtkLPSView2DProxy>(viewID.value)!
    );

    // Hide move handle when mouse leaves the view
    const mouseEntered = ref(false);

    manageVTKSubscription(
      viewProxy.value.getInteractor().onMouseEnter(() => {
        mouseEntered.value = true;
      })
    );

    manageVTKSubscription(
      viewProxy.value.getInteractor().onMouseLeave(() => {
        mouseEntered.value = false;
      })
    );

    const handlePoints = ref<Array<Vector2>>([]);
    const linePoints = ref<string>('');

    const updatePoints = () => {
      const viewRenderer = viewProxy.value.getRenderer();
      const svgPoints = points.value.map((point) => {
        const point2D = worldToSVG(point, viewRenderer);
        return point2D ?? ([0, 0] as Vector2);
      });

      if (placing.value && mouseEntered.value && movePoint.value) {
        const moveHandlePoint =
          worldToSVG(movePoint.value, viewRenderer) ?? ([0, 0] as Vector2);
        svgPoints.push(moveHandlePoint);
      }

      handlePoints.value = svgPoints;

      linePoints.value = handlePoints.value
        .map((point2D) => {
          return point2D?.join(',');
        })
        .join(' ');
    };

    const cameraOnModified = useVTKCallback(
      computed(() => viewProxy.value.getCamera().onModified)
    );
    cameraOnModified(updatePoints);

    watch([viewProxy, points, movePoint, placing, mouseEntered], updatePoints, {
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
