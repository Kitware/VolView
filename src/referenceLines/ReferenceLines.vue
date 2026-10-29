<template>
  <svg class="overlay-no-events" data-testid="reference-lines">
    <ReferenceLineSegments :segments="segments" />
  </svg>
</template>

<script setup lang="ts">
import { computed, inject, toRefs } from 'vue';
import type { Maybe } from '@/src/types';
import { VtkViewContext } from '@/src/components/vtk/context';
import { useVTKMultiWorldToSVG } from '@/src/composables/useVTKWorldToDisplay';
import ReferenceLineSegments from './ReferenceLineSegments.vue';
import { useReferenceLines } from './useReferenceLines';

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

const segments = computed(() => {
  const points = svgPoints.value;
  // The projection trails `lines` by a tick after a slice change.
  if (!points || points.length !== lines.value.length * 2) return [];

  return lines.value.map(({ viewId: peerViewId }, index) => {
    const [x1, y1] = points[index * 2];
    const [x2, y2] = points[index * 2 + 1];
    return { id: peerViewId, x1, y1, x2, y2 };
  });
});
</script>

<style scoped src="@/src/components/styles/vtk-view.css"></style>
