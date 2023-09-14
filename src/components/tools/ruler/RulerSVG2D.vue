<template>
  <g>
    <line
      v-if="first && second"
      :x1="first.x"
      :y1="first.y"
      :x2="second.x"
      :y2="second.y"
      :stroke="labelProps?.color"
      stroke-width="1"
    />
    <!-- radius is related to the vtkRulerWidget scale, specified in state -->
    <circle
      v-if="first"
      :cx="first.x"
      :cy="first.y"
      :stroke="labelProps?.color"
      stroke-width="1"
      fill="transparent"
      :r="10 / devicePixelRatio"
    />
    <circle
      v-if="second"
      :cx="second.x"
      :cy="second.y"
      :stroke="labelProps?.color"
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
import { useResizeObserver } from '@/src/composables/useResizeObserver';
import { onVTKEvent } from '@/src/composables/onVTKEvent';
import { ToolContainer } from '@/src/constants';
import { useViewStore } from '@/src/store/views';
import { worldToSVG } from '@/src/utils/vtk-helpers';
import vtkLPSView2DProxy from '@/src/vtk/LPSView2DProxy';
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
import { RulerSyncedState } from '@/src/components/tools/ruler/common';
import { Maybe } from '@/src/types';
import type { RulerStore } from '@/src/store/tools/rulers';

type SVGPoint = {
  x: number;
  y: number;
};

type LabelProps = RulerStore['labels'][string];

export default defineComponent({
  props: {
    viewId: {
      type: String,
      required: true,
    },
    syncedState: {
      type: Object as PropType<RulerSyncedState>,
      required: true,
    },
    labelProps: {
      type: Object as PropType<Maybe<LabelProps>>,
      required: true,
    },
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
    const { viewId: viewID, syncedState, textOffset } = toRefs(props);
    const firstPoint = ref<SVGPoint | null>();
    const secondPoint = ref<SVGPoint | null>();

    const viewStore = useViewStore();

    const viewProxy = computed(
      () => viewStore.getViewProxy<vtkLPSView2DProxy>(viewID.value)!
    );

    const updatePoints = () => {
      const state_ = syncedState.value;
      const viewRenderer = viewProxy.value.getRenderer();
      const pt1 = state_?.firstPoint.origin;
      const pt2 = state_?.secondPoint.origin;
      if (pt1 && state_?.firstPoint.visible) {
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

      if (pt2 && state_?.secondPoint.visible) {
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

    const camera = computed(() => viewProxy.value.getCamera());
    onVTKEvent(camera, 'onModified', updatePoints);

    watch(viewProxy, updatePoints);
    watch(syncedState, updatePoints, { deep: true });
    updatePoints();

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

    const containerEl = inject(ToolContainer)!;

    useResizeObserver(containerEl, () => {
      updatePoints();
    });

    return {
      devicePixelRatio,
      textdx: computed(() => textProperties.value?.dx ?? 0),
      textdy: computed(() => textProperties.value?.dy ?? 0),
      anchor: computed(() => textProperties.value?.anchor ?? 'start'),
      first: firstPoint,
      second: secondPoint,
      rulerLength: computed(() => syncedState.value.length.toFixed(2) ?? ''),
    };
  },
});
</script>

<style scoped>
.handle {
  cursor: pointer;
}
</style>
