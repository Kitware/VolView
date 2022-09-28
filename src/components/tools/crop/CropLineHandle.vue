<script lang="ts">
import { Vector2 } from '@kitware/vtk.js/types';
import { defineComponent, PropType, ref } from '@vue/composition-api';
import { CropLine } from './types';

export default defineComponent({
  props: {
    line: {
      required: true,
      type: Object as PropType<CropLine<Vector2>>,
    },
    clickWidth: {
      default: 20,
      type: Number,
    },
  },
  setup() {
    const cursor = ref('grab');
    const grabLineEl = ref<Element | null>(null);
    const focusWidth = ref(0);

    const onPointer = (down: boolean, ev: PointerEvent) => {
      if (down) {
        grabLineEl.value?.setPointerCapture(ev.pointerId);
      } else {
        grabLineEl.value?.releasePointerCapture(ev.pointerId);
      }
      cursor.value = down ? 'grabbing' : 'grab';
    };

    const onHover = (hover: boolean) => {
      focusWidth.value = hover ? 2 : 0;
    };

    return {
      onPointer,
      onHover,
      cursor,
      grabLineEl,
      focusWidth,
    };
  },
});
</script>

<template>
  <g>
    <line
      :x1="line.startEdge[0]"
      :y1="line.startEdge[1]"
      :x2="line.startCrop[0]"
      :y2="line.startCrop[1]"
      :stroke-width="2 + focusWidth"
      stroke-dasharray="6"
      stroke-linecap="square"
      stroke="rgba(200, 255, 0, 0.5)"
    />
    <line
      :x1="line.startCrop[0]"
      :y1="line.startCrop[1]"
      :x2="line.endCrop[0]"
      :y2="line.endCrop[1]"
      :stroke-width="2 + focusWidth"
      stroke-dasharray="none"
      stroke-linecap="butt"
      stroke="rgb(200, 255, 0)"
    />
    <line
      :x1="line.endCrop[0]"
      :y1="line.endCrop[1]"
      :x2="line.endEdge[0]"
      :y2="line.endEdge[1]"
      :stroke-width="2 + focusWidth"
      stroke-dasharray="6"
      stroke-linecap="square"
      stroke="rgba(200, 255, 0, 0.5)"
    />
    <!-- the listener hitbox -->
    <line
      ref="grabLineEl"
      class="pointer-events-all"
      :style="{ cursor }"
      @pointerenter="onHover(true)"
      @pointerleave="onHover(false)"
      @pointerdown="onPointer(true, $event)"
      @pointerup="onPointer(false, $event)"
      v-on="$listeners"
      :x1="line.startEdge[0]"
      :y1="line.startEdge[1]"
      :x2="line.endEdge[0]"
      :y2="line.endEdge[1]"
      fill="none"
      stroke-opacity="0"
      stroke-dasharray="none"
      :stroke-width="Number($attrs['stroke-width'] || 0) + clickWidth || 0"
    />
  </g>
</template>

<style scoped src="@/src/components/styles/utils.css"></style>
