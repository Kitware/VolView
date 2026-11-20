<script setup lang="ts">
import { computed, toRefs, watchEffect } from 'vue';
import type { SlabSpecification } from '@/src/core/slab/types';
import type { SlabGeometry } from '@/src/core/slab/geometry';
import { useSegmentStore } from '@/src/segmentation/segments';
import { toLabelmapSegment } from '@/src/segmentation/segment';
import { SEGMENT_VALUE } from '@/src/segmentation/masks/labelValue';
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
  segmentId: string;
  source: EnFaceImageSource;
  slab: SlabSpecification;
  geometry: SlabGeometry | null;
  measurer: OccupiedDepthMeasurer;
  projection: SegmentProjection;
  /** Zero when the slab axis has no physical calibration. */
  micronsPerVoxel: number;
}>();
const emit = defineEmits<{ state: [state: SegmentOverlayState] }>();
const { segmentId } = toRefs(props);
const registry = useSegmentStore().segments;
const { request, geometryReason } = useMaskDepthRequest(
  props.source,
  computed(() => props.slab),
  segmentId
);
const { accepted, computing, error } = useOccupiedDepth(
  request,
  props.measurer
);
// The overlay uses the segment's normal fill and outline settings.
const appearance = computed(() => {
  const segment = registry.getSegment(segmentId.value);
  return segment
    ? labelmapAppearance(
        toLabelmapSegment(segment, SEGMENT_VALUE),
        registry.displayOf(registry.ownerImageId(segmentId.value))
      )
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
