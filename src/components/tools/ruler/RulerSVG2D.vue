<template>
  <g>
    <line
      v-if="first && second"
      :x1="first.x"
      :y1="first.y"
      :x2="second.x"
      :y2="second.y"
      stroke="yellow"
      stroke-width="1"
    />
    <!-- radius is related to the vtkRulerWidget scale, specified in state -->
    <circle
      v-if="first"
      :cx="first.x"
      :cy="first.y"
      stroke="yellow"
      stroke-width="1"
      fill="transparent"
      :r="10 / devicePixelRatio"
    />
    <circle
      v-if="second"
      :cx="second.x"
      :cy="second.y"
      stroke="yellow"
      stroke-width="1"
      fill="transparent"
      :r="10 / devicePixelRatio"
      class="handle"
    />
    <text
      v-if="second"
      :x="second.x"
      :y="second.y"
      :dx="textdx"
      :dy="textdy"
      :text-anchor="anchor"
      stroke-width="0"
      fill="yellow"
      :font-size="`${textSize}px`"
    >
      {{ rulerLength }}
    </text>
  </g>
</template>

<script lang="ts">
import { manageVTKSubscription } from '@/src/composables/manageVTKSubscription';
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
  watchEffect,
} from '@vue/composition-api';

type SVGPoint = {
  x: number;
  y: number;
};

export default defineComponent({
  props: {
    point1: Array as PropType<Array<number>>,
    point2: Array as PropType<Array<number>>,
    length: Number,
    viewId: {
      type: String,
      required: true,
    },
    textOffset: {
      type: Number,
      default: 8,
    },
    textSize: {
      type: Number,
      default: 12,
    },
  },
  setup(props) {
    const {
      viewId: viewID,
      point1,
      point2,
      textOffset,
      length,
    } = toRefs(props);
    const firstPoint = ref<SVGPoint | null>();
    const secondPoint = ref<SVGPoint | null>();

    const viewStore = useViewStore();

    const viewProxy = viewStore.getViewProxy<vtkLPSView2DProxy>(viewID.value);
    if (!viewProxy) {
      throw new Error('[RulerSVG2D] Could not get view proxy');
    }
    const viewRenderer = viewProxy.getRenderer();

    const updatePoints = () => {
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
      }
      if (pt2) {
        const point2D = worldToSVG(pt2, viewRenderer);
        if (point2D) {
          secondPoint.value = {
            x: point2D[0],
            y: point2D[1],
          };
        }
      }
    };

    manageVTKSubscription(viewProxy.getCamera().onModified(updatePoints));

    watchEffect(updatePoints);

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

    return {
      devicePixelRatio,
      textdx: computed(() => textProperties.value?.dx ?? 0),
      textdy: computed(() => textProperties.value?.dy ?? 0),
      anchor: computed(() => textProperties.value?.anchor ?? 'start'),
      first: firstPoint,
      second: secondPoint,
      rulerLength: computed(() => length?.value?.toFixed(2) ?? ''),
    };
  },
});
</script>

<style scoped>
.handle {
  cursor: pointer;
}
</style>
