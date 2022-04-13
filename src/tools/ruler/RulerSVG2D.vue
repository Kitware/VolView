<template>
  <g>
    <line
      v-if="point1 && point2"
      :x1="point1[0]"
      :y1="point1[1]"
      :x2="point2[0]"
      :y2="point2[1]"
      stroke="yellow"
      stroke-width="1"
    />
    <!-- radius is related to the vtkRulerWidget scale, specified in state -->
    <circle
      v-if="point1"
      :cx="point1[0]"
      :cy="point1[1]"
      stroke="yellow"
      stroke-width="1"
      fill="transparent"
      :r="10 / devicePixelRatio"
    />
    <circle
      v-if="point2"
      :cx="point2[0]"
      :cy="point2[1]"
      stroke="yellow"
      stroke-width="1"
      fill="transparent"
      :r="10 / devicePixelRatio"
      class="handle"
    />
    <text
      v-if="point2"
      :x="point2[0]"
      :y="point2[1]"
      :dx="textdx"
      :dy="textdy"
      :text-anchor="anchor"
      stroke-width="0"
      fill="yellow"
      :font-size="`${textSize}px`"
    >
      {{ length.toFixed(2) }}
    </text>
  </g>
</template>

<script lang="ts">
import {
  PropType,
  computed,
  defineComponent,
  toRefs,
  unref,
} from '@vue/composition-api';

export default defineComponent({
  props: {
    point1: Array as PropType<Array<number>>,
    point2: Array as PropType<Array<number>>,
    length: Number,
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
    const { point1, point2, textOffset } = toRefs(props);

    const textProperties = computed(() => {
      const first = unref(point1);
      const second = unref(point2);
      const offset = textOffset.value;
      if (!first || !second) {
        return null;
      }
      if (second[0] > first[0]) {
        return { dx: offset, dy: -offset, anchor: 'start' };
      }
      return { dx: -offset, dy: -offset, anchor: 'end' };
    });

    return {
      devicePixelRatio,
      textdx: computed(() => textProperties.value?.dx ?? 0),
      textdy: computed(() => textProperties.value?.dy ?? 0),
      anchor: computed(() => textProperties.value?.anchor ?? 'start'),
    };
  },
});
</script>

<style scoped>
.handle {
  cursor: pointer;
}
</style>