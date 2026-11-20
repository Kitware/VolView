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
    : masks.value.flatMap(({ segmentId }) => {
        const projection = settings.value.segmentProjections[segmentId];
        return projection?.visible && segments.appearanceOf(segmentId).visible
          ? [{ id: segmentId, projection }]
          : [];
      })
);
// One worker serves every shown segment; an idle view keeps no mask copies.
const measurer = createWorkerMeasurer();
onScopeDispose(measurer.release);
const states = reactive<Record<string, SegmentOverlayState>>({});
watchEffect(() => {
  const ids = overlays.value.map((overlay) => overlay.id);
  if (ids.length) measurer.retain(ids);
  else measurer.release();
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
    segments: masks.value.map(({ segmentId }) => {
      const appearance = segments.appearanceOf(segmentId);
      return {
        id: segmentId,
        title: appearance.displayName,
        color: appearance.cssColor,
        listHidden: !appearance.visible,
        thresholdMaximum: states[segmentId]?.thresholdMaximum ?? null,
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
    :segment-id="overlay.id"
    :source="source"
    :slab="slab"
    :geometry="geometry"
    :measurer="measurer"
    :projection="overlay.projection"
    :microns-per-voxel="
      calibration.reason.value ? 0 : calibration.micronsPerVoxel.value
    "
    @state="states[overlay.id] = $event"
  />
  <EnFaceMeasurementStatus :message="message" />
</template>
