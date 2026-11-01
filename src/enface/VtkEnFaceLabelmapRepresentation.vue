<script setup lang="ts">
import { computed, inject, toRefs } from 'vue';
import { VtkViewContext } from '@/src/components/vtk/context';
import {
  useLabelmapRepresentation,
  type LabelmapAppearance,
} from '@/src/segmentation/rendering/useLabelmapRepresentation';
import {
  useEnFaceLabelmaps,
  type MeasurementPlaneGeometry,
} from './useEnFaceLabelmaps';
import type { OccupiedDepthResult } from '@/src/segmentation/measurements/occupiedDepth';

const props = defineProps<{
  geometry: MeasurementPlaneGeometry | null;
  measurement: OccupiedDepthResult | null;
  micronsPerVoxel: number;
  threshold: number;
  appearance: LabelmapAppearance | null;
}>();
const { geometry, measurement, micronsPerVoxel, threshold, appearance } =
  toRefs(props);
const view = inject(VtkViewContext);
if (!view) throw new Error('No VtkView');
const thinRegions = useEnFaceLabelmaps(
  geometry,
  measurement,
  threshold,
  micronsPerVoxel
);
useLabelmapRepresentation(
  view,
  computed(() => (appearance.value ? thinRegions.value : null)),
  appearance,
  { axis: 2 }
);
</script>

<template>
  <slot />
</template>
