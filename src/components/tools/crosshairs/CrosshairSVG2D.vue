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
import { onVTKEvent } from '@/src/composables/onVTKEvent';
import { worldToSVG } from '@/src/utils/vtk-helpers';
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
import { VtkViewContext } from '@/src/components/vtk/context';
import { vtkFieldRef } from '@/src/core/vtk/vtkFieldRef';
import { useResizeObserver } from '@vueuse/core';

type SVGPoint = {
  x: number;
  y: number;
};

export default defineComponent({
  props: {
    position: Array as PropType<Array<number>>,
  },
  setup(props) {
    const { position } = toRefs(props);
    const position2D = ref<SVGPoint>();

    const view = inject(VtkViewContext);
    if (!view) throw new Error('No VtkView');

    const updatePoints = () => {
      const viewRenderer = view.renderer;
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

    const camera = vtkFieldRef(view.renderer, 'activeCamera');
    onVTKEvent(camera, 'onModified', updatePoints);

    watchEffect(updatePoints);

    // --- resize --- //

    const container = vtkFieldRef(view.renderWindowView, 'container');
    useResizeObserver(container, () => {
      updatePoints();
    });

    return {
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
