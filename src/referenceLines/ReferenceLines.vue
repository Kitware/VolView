<template>
  <svg class="overlay-no-events" data-testid="reference-lines">
    <line
      v-for="piece in pieces"
      :key="piece.key"
      :x1="piece.x1"
      :y1="piece.y1"
      :x2="piece.x2"
      :y2="piece.y2"
      stroke="yellow"
      stroke-width="1"
    />
  </svg>
</template>

<script setup lang="ts">
import { computed, inject, toRefs } from 'vue';
import type { Maybe } from '@/src/types';
import { VtkViewContext } from '@/src/components/vtk/context';
import { useVTKMultiWorldToSVG } from '@/src/composables/useVTKWorldToDisplay';
import { splitSegmentsAtCrossings } from './crossings';
import { useReferenceLines } from './useReferenceLines';

// Clear space left where two lines cross, in pixels.
const CROSSING_GAP = 16;

type Props = {
  viewId: string;
  imageId: Maybe<string>;
};

const props = defineProps<Props>();
const { viewId, imageId } = toRefs(props);

const view = inject(VtkViewContext);
if (!view) throw new Error('No VtkView');

const lines = useReferenceLines(viewId, imageId);
const endpoints = computed(() =>
  lines.value.flatMap(({ line }) => [line.p1, line.p2])
);
const svgPoints = useVTKMultiWorldToSVG(endpoints, view.renderer);

const pieces = computed(() => {
  const points = svgPoints.value;
  // The projection trails `lines` by a tick after a slice change.
  if (!points || points.length !== lines.value.length * 2) return [];

  const segments = lines.value.map(({ viewId: peerViewId }, index) => {
    const [x1, y1] = points[index * 2];
    const [x2, y2] = points[index * 2 + 1];
    return { id: peerViewId, x1, y1, x2, y2 };
  });
  return splitSegmentsAtCrossings(segments, CROSSING_GAP);
});
</script>

<style scoped src="@/src/components/styles/vtk-view.css"></style>
