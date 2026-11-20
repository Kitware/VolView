<script setup lang="ts">
import { computed, onScopeDispose, reactive, watchEffect } from 'vue';
import type { SlabSpecification } from '@/src/core/slab/types';
import type { SlabGeometry } from '@/src/core/slab/geometry';
import { useSegmentationStore } from '@/src/segmentation/store';
import { useSegmentStore } from '@/src/segmentation/segments';
import { createWorkerMeasurer } from '@/src/segmentation/measurements/useOccupiedDepth';
import type { EnFaceImageSource } from './useMaskDepthRequest';
import { useThinCalibration } from './useThinCalibration';
import { useEnFaceViewStore, type SegmentControlState } from './store';
import EnFaceSegmentOverlay, {
  type SegmentOverlayState,
} from './EnFaceSegmentOverlay.vue';
import EnFaceMeasurementStatus from './EnFaceMeasurementStatus.vue';

const props = defineProps<{
  viewId: string;
  source: EnFaceImageSource;
  slab: SlabSpecification;
  geometry: SlabGeometry | null;
  blockedReason: string | null;
}>();
const emit = defineEmits<{
  controls: [state: SegmentControlState];
  measuring: [measuring: boolean];
}>();
const store = useEnFaceViewStore();
const segmentation = useSegmentationStore();
const segments = useSegmentStore().segments;
const settings = computed(() =>
  store.settingsFor(props.viewId, props.source.currentImageID.value)
);
const calibration = useThinCalibration(
  props.source,
  computed(() => props.slab)
);
const masks = computed(() => {
  const imageId = props.source.currentImageID.value;
  return imageId ? segmentation.imageMasks(imageId) : [];
});
// Segments shown here that the slice views also show.
const overlays = computed(() =>
  props.blockedReason
    ? []
    : masks.value.flatMap((mask) => {
        const projection = settings.value.segmentProjections[mask.segmentId];
        return projection?.visible &&
          segmentation.labelmapDescriptorByMask[mask.id]?.visible
          ? [{ id: mask.id, projection }]
          : [];
      })
);
const measurer = createWorkerMeasurer();
const borrowMeasurer = () => ({ measure: measurer.measure, release() {} });
onScopeDispose(measurer.release);
const states = reactive<Record<string, SegmentOverlayState>>({});
watchEffect(() => {
  const ids = overlays.value.map((overlay) => overlay.id);
  measurer.retain(ids);
  if (!ids.length) measurer.release();
  Object.keys(states).forEach((id) => {
    if (!ids.includes(id)) delete states[id];
  });
});
const message = computed(
  () =>
    [
      ...new Set(
        Object.values(states)
          .map((state) => state.message)
          .filter(Boolean)
      ),
    ].join(' ') || null
);
watchEffect(() =>
  emit(
    'measuring',
    Object.values(states).some((state) => state.measuring)
  )
);
watchEffect(() =>
  emit('controls', {
    segments: masks.value.map((mask) => {
      const appearance = segments.appearanceOf(mask.segmentId);
      return {
        id: mask.segmentId,
        title: appearance.displayName,
        color: appearance.cssColor,
        listHidden: !segmentation.labelmapDescriptorByMask[mask.id]?.visible,
        thresholdMaximum: states[mask.id]?.thresholdMaximum ?? null,
      };
    }),
    segmentationReason:
      props.blockedReason ||
      (masks.value.length
        ? null
        : 'Load or create a segmentation mask associated with this volume.'),
    thinReason: calibration.reason.value,
  })
);
</script>

<template>
  <EnFaceSegmentOverlay
    v-for="overlay in overlays"
    :key="overlay.id"
    :mask-id="overlay.id"
    :source="source"
    :slab="slab"
    :geometry="geometry"
    :create-measurer="borrowMeasurer"
    :projection="overlay.projection"
    :microns-per-voxel="
      calibration.reason.value ? 0 : calibration.micronsPerVoxel.value
    "
    @state="states[overlay.id] = $event"
  />
  <EnFaceMeasurementStatus :message="message" />
</template>
