<template>
  <g>
    <line
      v-if="x != null && y != null"
      :x1="x"
      y1="0%"
      :x2="x"
      :y2="y - 8"
      stroke="yellow"
      stroke-width="1"
    />
    <line
      v-if="x != null && y != null"
      :x1="x"
      :y1="y + 8"
      :x2="x"
      y2="100%"
      stroke="yellow"
      stroke-width="1"
    />
    <line
      v-if="x != null && y != null"
      x1="0%"
      :y1="y"
      :x2="x - 8"
      :y2="y"
      stroke="yellow"
      stroke-width="1"
    />
    <line
      v-if="x != null && y != null"
      :x1="x + 8"
      :y1="y"
      x2="100%"
      :y2="y"
      stroke="yellow"
      stroke-width="1"
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
import type { Vector3 } from '@kitware/vtk.js/types';
import {
  PropType,
  defineComponent,
  toRefs,
  unref,
  ref,
  watchEffect,
  computed,
  inject,
} from 'vue';

type SVGPoint = {
  x: number;
  y: number;
};

export default defineComponent({
  props: {
    position: Array as PropType<Array<number>>,
    viewId: {
      type: String,
      required: true,
    },
  },
  setup(props) {
    const { viewId: viewID, position } = toRefs(props);
    const position2D = ref<SVGPoint>();

    const viewStore = useViewStore();

    const viewProxy = computed(
      () => viewStore.getViewProxy<vtkLPSView2DProxy>(viewID.value)!
    );

    const updatePoints = () => {
      const viewRenderer = viewProxy.value.getRenderer();
      const pt = unref(position) as Vector3 | undefined;
      if (pt) {
        const point2D = worldToSVG(pt, viewRenderer);
        if (point2D) {
          position2D.value = {
            x: point2D[0],
            y: point2D[1],
          };
        }
      }
    };

    const cameraOnModified = useVTKCallback(
      computed(() => viewProxy.value.getCamera().onModified)
    );
    cameraOnModified(updatePoints);

    watchEffect(updatePoints);

    // --- resize --- //

    const containerEl = inject(ToolContainer)!;

    useResizeObserver(containerEl, () => {
      updatePoints();
    });

    return {
      devicePixelRatio,
      x: computed(() => position2D.value?.x),
      y: computed(() => position2D.value?.y),
    };
  },
});
</script>

<style scoped>
.handle {
  cursor: pointer;
}
</style>
