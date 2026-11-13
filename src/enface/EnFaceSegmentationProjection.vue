<script setup lang="ts">
import { computed, onScopeDispose, reactive, watchEffect } from 'vue';
import type { SlabSpecification } from '@/src/core/slab/types';
import type { SlabGeometry } from '@/src/core/slab/geometry';
import { useSegmentationStore } from '@/src/segmentation/store';
import { createWorkerMeasurer } from '@/src/segmentation/measurements/useOccupiedDepth';
import type { OccupiedDepthProjection } from './useOccupiedDepthInput';
import { useEnFaceViewStore } from './store';
import EnFaceSegmentFootprint from './EnFaceSegmentFootprint.vue';
import EnFaceMeasurementStatus from './EnFaceMeasurementStatus.vue';

const props = defineProps<{
  viewId: string;
  source: OccupiedDepthProjection['source'];
  slab: SlabSpecification;
  geometry: SlabGeometry | null;
  blockedReason: string | null;
}>();
const store = useEnFaceViewStore();
const segmentation = useSegmentationStore();
const settings = computed(() =>
  store.settingsFor(props.viewId, props.source.currentImageID.value)
);
const masks = computed(() => {
  if (!settings.value.showFootprints || props.blockedReason) return [];
  return [...new Set(settings.value.footprintSegmentIds)].flatMap((id) => {
    const mask = segmentation.maskFor(props.source.currentImageID.value, id);
    return mask && segmentation.labelmapDescriptorByMask[mask.id]?.visible
      ? [mask]
      : [];
  });
});
const selectedSlab = computed(() =>
  settings.value.footprintScope === 'volume'
    ? {
        ...props.slab,
        first: 0,
        last:
          (props.source.currentImageData.value?.getDimensions()[
            props.slab.axis
          ] ?? 1) - 1,
      }
    : props.slab
);
const measurer = createWorkerMeasurer();
const borrowMeasurer = () => ({ measure: measurer.measure, release() {} });
onScopeDispose(measurer.release);
const statuses = reactive<Record<string, string | null>>({});
watchEffect(() => {
  const ids = masks.value.map((mask) => mask.id);
  measurer.retain(ids);
  if (!ids.length) measurer.release();
  Object.keys(statuses).forEach((id) => {
    if (!ids.includes(id)) delete statuses[id];
  });
});
const message = computed(
  () =>
    [
      ...new Set(masks.value.map((mask) => statuses[mask.id]).filter(Boolean)),
    ].join(' ') || null
);
</script>

<template>
  <EnFaceSegmentFootprint
    v-for="mask in masks"
    :key="mask.id"
    :view-id="viewId"
    :segment-id="mask.segmentId"
    :source="source"
    :slab="selectedSlab"
    :geometry="geometry"
    :blocked-reason="blockedReason"
    :create-measurer="borrowMeasurer"
    @status="statuses[mask.id] = $event"
  />
  <EnFaceMeasurementStatus :message="message" />
</template>
