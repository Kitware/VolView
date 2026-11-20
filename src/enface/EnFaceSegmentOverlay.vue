<script setup lang="ts">
import { computed, toRefs, watchEffect } from 'vue';
import type { SlabSpecification } from '@/src/core/slab/types';
import type { SlabGeometry } from '@/src/core/slab/geometry';
import { useSegmentationStore } from '@/src/segmentation/store';
import { labelmapAppearance } from '@/src/segmentation/rendering/display';
import {
  useOccupiedDepth,
  type OccupiedDepthMeasurer,
} from '@/src/segmentation/measurements/useOccupiedDepth';
import {
  useMaskDepthRequest,
  type EnFaceImageSource,
} from './useMaskDepthRequest';
import { thicknessSliderMaximum } from './thickness';
import type { SegmentProjection } from './store';
import VtkEnFaceLabelmapRepresentation from './VtkEnFaceLabelmapRepresentation.vue';

export type SegmentOverlayState = {
  message: string | null;
  measuring: boolean;
  /** Null until a measurement gives the thickness range. */
  thresholdMaximum: number | null;
};

const props = defineProps<{
  maskId: string;
  source: EnFaceImageSource;
  slab: SlabSpecification;
  geometry: SlabGeometry | null;
  createMeasurer: () => OccupiedDepthMeasurer;
  projection: SegmentProjection;
  /** Zero when the slab axis has no physical calibration. */
  micronsPerVoxel: number;
}>();
const emit = defineEmits<{ state: [state: SegmentOverlayState] }>();
const { maskId } = toRefs(props);
const segmentationStore = useSegmentationStore();
const { request, geometryReason } = useMaskDepthRequest(
  props.source,
  computed(() => props.slab),
  maskId
);
const { accepted, computing, error } = useOccupiedDepth(
  request,
  props.createMeasurer
);
// The overlay uses the segment's normal fill and outline settings.
const appearance = computed(() => {
  const descriptor = segmentationStore.labelmapDescriptorByMask[maskId.value];
  const segmentation = segmentationStore.segmentationOfMask(maskId.value);
  return descriptor && segmentation
    ? labelmapAppearance(descriptor, segmentation)
    : null;
});
const threshold = computed(() =>
  props.micronsPerVoxel > 0 ? props.projection.thresholdMicrons : null
);
watchEffect(() =>
  emit('state', {
    message: geometryReason.value || error.value,
    measuring: computing.value,
    thresholdMaximum: accepted.value
      ? thicknessSliderMaximum(accepted.value, props.micronsPerVoxel)
      : null,
  })
);
</script>

<template>
  <VtkEnFaceLabelmapRepresentation
    :geometry="geometry"
    :measurement="accepted"
    :threshold="threshold"
    :microns-per-voxel="micronsPerVoxel"
    :appearance="appearance"
  />
</template>
