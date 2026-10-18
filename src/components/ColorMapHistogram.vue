<script setup lang="ts">
import { computed } from 'vue';
import type { ImageHistogram } from '@/src/store/image-stats';

const PREVIEW_BIN_COUNT = 128;

const props = defineProps<{
  histogram?: ImageHistogram;
  dataRange: readonly [number, number];
}>();
const path = computed(() => {
  const histogram = props.histogram;
  const [min, max] = props.dataRange;
  const span = max - min;
  if (
    !histogram ||
    ![min, max, span, histogram.origin, histogram.binWidth].every(
      Number.isFinite
    ) ||
    span <= 0 ||
    histogram.binWidth <= 0 ||
    !histogram.counts.every((count) => Number.isFinite(count) && count >= 0)
  )
    return '';
  const groupSize = Math.max(
    1,
    Math.ceil(histogram.counts.length / PREVIEW_BIN_COUNT)
  );
  const counts = Array.from(
    { length: Math.ceil(histogram.counts.length / groupSize) },
    (_, index) =>
      histogram.counts
        .slice(index * groupSize, (index + 1) * groupSize)
        .reduce((sum, count) => sum + count, 0)
  );
  const binWidth = histogram.binWidth * groupSize;
  const peak = Math.max(0, ...counts);
  if (!peak) return '';
  const position = (value: number) =>
    Math.max(0, Math.min(1, (value - min) / span));
  const steps = counts.flatMap((count, index) => {
    const start = histogram.origin + index * binWidth;
    const end = start + binWidth;
    if (start > max || end < min) return [];
    const height = 15.5 - (count / peak) * 15;
    return [`H${position(start)} V${height} H${position(end)}`];
  });
  return steps.length ? `M0 15.5 ${steps.join(' ')} V15.5 H0 Z` : '';
});
</script>

<template>
  <svg
    v-if="path"
    class="color-map-histogram"
    viewBox="0 0 1 16"
    preserveAspectRatio="none"
    aria-hidden="true"
    focusable="false"
  >
    <path :d="path" vector-effect="non-scaling-stroke" />
  </svg>
</template>

<style scoped>
.color-map-histogram {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  border-radius: 4px;
  pointer-events: none;
}

path {
  fill: rgb(var(--v-theme-on-surface));
  fill-opacity: 0.15;
  stroke: rgb(var(--v-theme-on-surface));
  stroke-opacity: 0.35;
  stroke-width: 0.75;
}
</style>
