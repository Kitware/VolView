<script setup lang="ts">
import { computed, toRefs, watchEffect } from 'vue';
import type { SlabSpecification } from '@/src/core/slab/types';
import type { SlabGeometry } from '@/src/core/slab/geometry';
import {
  useOccupiedDepth,
  type OccupiedDepthMeasurer,
} from '@/src/segmentation/measurements/useOccupiedDepth';
import {
  useOccupiedDepthInput,
  type OccupiedDepthProjection,
} from './useOccupiedDepthInput';
import { useThinRegionAppearance } from './useThinRegionAppearance';
import VtkEnFaceLabelmapRepresentation from './VtkEnFaceLabelmapRepresentation.vue';

const props = defineProps<{
  viewId: string;
  segmentId: string;
  source: OccupiedDepthProjection['source'];
  slab: SlabSpecification;
  geometry: SlabGeometry | null;
  blockedReason: string | null;
  createMeasurer: () => OccupiedDepthMeasurer;
}>();
const emit = defineEmits<{ status: [message: string | null] }>();
const { viewId, segmentId, slab, blockedReason } = toRefs(props);
const input = useOccupiedDepthInput(
  viewId,
  { source: props.source, slab, blockedReason },
  { segmentId, enabled: true, calibrated: false }
);
const appearance = useThinRegionAppearance(
  computed(() => input.selectedMask.value?.id),
  'show its footprint'
);
const { accepted, computing, error } = useOccupiedDepth(
  input.request,
  props.createMeasurer
);
const message = computed(
  () =>
    input.thicknessReason.value ||
    appearance.value?.reason ||
    error.value ||
    (computing.value && !accepted.value
      ? 'Projecting segment footprints…'
      : null)
);
watchEffect(() => emit('status', message.value));
const visibleAppearance = computed(() =>
  !input.thicknessReason.value && !appearance.value?.reason && !error.value
    ? appearance.value
    : null
);
</script>

<template>
  <VtkEnFaceLabelmapRepresentation
    :geometry="geometry"
    :measurement="accepted"
    :threshold="null"
    :microns-per-voxel="0"
    :appearance="visibleAppearance"
  />
</template>
