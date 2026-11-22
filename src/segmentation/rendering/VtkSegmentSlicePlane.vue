<script setup lang="ts">
import { computed, inject, toRefs } from 'vue';
import { VtkViewContext } from '@/src/components/vtk/context';
import { useSegmentStore } from '@/src/segmentation/segments';
import { toLabelmapSegment } from '@/src/segmentation/segment';
import { useLabelmapRepresentation } from '@/src/segmentation/rendering/useLabelmapRepresentation';
import { labelmapAppearance } from '@/src/segmentation/rendering/display';
import { revealPulse } from '@/src/segmentation/rendering/revealPulse';
import type vtkLabelMap from '@/src/vtk/LabelMap';

const props = defineProps<{
  image: vtkLabelMap;
  segmentIds: string[];
  display: {
    fillOpacity: number;
    outlineThickness: number;
    outlineOpacity: number;
  };
  axis: number | undefined;
}>();
const { image, segmentIds, display, axis } = toRefs(props);

const view = inject(VtkViewContext);
if (!view) throw new Error('No VtkView');

const registry = useSegmentStore().segments;
// Appearance changes rebuild these tables without recomposing the plane.
const labels = computed(() =>
  segmentIds.value.flatMap((segmentId, index) => {
    const segment = registry.getSegment(segmentId);
    if (!segment) return [];
    return [
      labelmapAppearance(
        toLabelmapSegment(segment, index + 1),
        display.value,
        revealPulse(segmentId)
      ),
    ];
  })
);

useLabelmapRepresentation(view, image, labels, axis);
</script>

<template>
  <slot></slot>
</template>
