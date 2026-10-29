<script setup lang="ts">
import { computed } from 'vue';
import { mat2d, type ReadonlyMat2d } from 'gl-matrix';
import { splitSegmentsAtCrossings, type ScreenSegment } from './crossings';

const props = defineProps<{
  segments: ScreenSegment[];
  transformMatrix?: ReadonlyMat2d;
}>();

const CROSSING_GAP = 16;

function coordinates(line: Omit<ScreenSegment, 'id'>, matrix: ReadonlyMat2d) {
  const [a, b, c, d, e, f] = matrix;
  return {
    x1: a * line.x1 + c * line.y1 + e,
    y1: b * line.x1 + d * line.y1 + f,
    x2: a * line.x2 + c * line.y2 + e,
    y2: b * line.x2 + d * line.y2 + f,
  };
}

const transform = computed(() =>
  props.transformMatrix
    ? `matrix(${Array.from(props.transformMatrix).join(',')})`
    : undefined
);
const pieces = computed(() => {
  const matrix = props.transformMatrix ?? mat2d.create();
  const inverse = mat2d.invert(new Array(6) as mat2d, matrix);
  if (!inverse) return [];
  // Split in screen coordinates so zoom and unequal voxel spacing preserve the gap.
  const screenSegments = props.segments.map((line) => ({
    ...line,
    ...coordinates(line, matrix),
  }));
  return splitSegmentsAtCrossings(screenSegments, CROSSING_GAP).map((line) => ({
    ...line,
    ...coordinates(line, inverse),
  }));
});
</script>

<template>
  <g :transform="transform">
    <line
      v-for="piece in pieces"
      :key="piece.key"
      :data-view-id="piece.id"
      data-testid="reference-line"
      v-bind="{ x1: piece.x1, y1: piece.y1, x2: piece.x2, y2: piece.y2 }"
      stroke="yellow"
      stroke-width="1"
      vector-effect="non-scaling-stroke"
    />
  </g>
</template>
