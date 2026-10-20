<script setup lang="ts">
import { computed, inject, toRefs } from 'vue';
import type vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import { VtkViewContext } from '@/src/components/vtk/context';
import {
  useLabelmapRepresentation,
  type LabelmapAppearance,
} from '@/src/segmentation/rendering/useLabelmapRepresentation';
import { useEnFaceLabelmaps } from './useEnFaceLabelmaps';
import type { ProjectionResult } from './types';

const props = defineProps<{
  imageData: vtkImageData | null;
  projection: ProjectionResult | null;
  threshold: number;
  appearance: LabelmapAppearance | null;
}>();
const { imageData, projection, threshold, appearance } = toRefs(props);
const view = inject(VtkViewContext);
if (!view) throw new Error('No VtkView');
const { thinRegions, invalidPixels } = useEnFaceLabelmaps(
  imageData,
  projection,
  threshold
);
useLabelmapRepresentation(
  view,
  computed(() => (appearance.value ? thinRegions.value : null)),
  appearance,
  { axis: 2 }
);
useLabelmapRepresentation(
  view,
  invalidPixels,
  {
    value: 1,
    color: [0, 0, 0],
    fillOpacity: 1,
    outlineThickness: 0,
    outlineOpacity: 0,
  },
  // Coverage stays fully opaque while sharing the overlay rendering pass.
  { axis: 2, actorOpacity: 1, forceTranslucent: true, useLabelOutline: false }
);
</script>

<template>
  <slot />
</template>
