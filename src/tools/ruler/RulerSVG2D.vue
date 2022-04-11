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
  </g>
</template>

<script lang="ts">
import { defineComponent } from '@vue/composition-api';

export default defineComponent({
  props: {
    point1: Array,
    point2: Array,
  },
  setup() {
    return {
      devicePixelRatio,
    };
  },
});
</script>

<style scoped>
.handle {
  cursor: pointer;
}
</style>