import { computed, unref, type MaybeRef } from 'vue';
import { useOccupiedDepth } from '@/src/segmentation/measurements/useOccupiedDepth';
import type { SlabGeometry } from '@/src/core/slab/geometry';
import {
  useOccupiedDepthInput,
  type OccupiedDepthProjection,
} from './useOccupiedDepthInput';
import { useThinRegionAppearance } from './useThinRegionAppearance';
import { thicknessSliderMaximum } from './thickness';
import type { ThicknessControlState } from './store';

/** Thin-region highlighting for one En face view, layered over its projection. */
export function useEnFaceOccupiedDepth(
  viewId: MaybeRef<string>,
  projection: OccupiedDepthProjection & {
    geometry: MaybeRef<SlabGeometry | null>;
  },
  createWorker?: () => Worker
) {
  const { geometry, blockedReason } = projection;
  const input = useOccupiedDepthInput(viewId, projection);
  const { settings, micronsPerVoxel } = input;
  const appearance = useThinRegionAppearance(
    computed(() => input.selectedMask.value?.id)
  );
  const {
    accepted: measurement,
    computing: measuring,
    error,
  } = useOccupiedDepth(
    input.request,
    createWorker,
    computed(() => settings.value.highlightThin)
  );
  const thicknessReason = computed(
    () =>
      input.thicknessReason.value ||
      appearance.value?.reason ||
      error.value ||
      (measuring.value && !measurement.value
        ? 'Measuring thickness in the selected slab…'
        : null)
  );
  const message = computed(() => {
    if (!settings.value.highlightThin || unref(blockedReason)) return null;
    // Without a reason, a running measurement has a previous result to show.
    return (
      thicknessReason.value ||
      (measuring.value
        ? 'Updating thickness; showing the previous result.'
        : null)
    );
  });
  const overlay = computed(() => ({
    geometry: unref(geometry),
    measurement: measurement.value,
    micronsPerVoxel: micronsPerVoxel.value,
    threshold: settings.value.thresholdMicrons,
    appearance:
      settings.value.highlightThin && !thicknessReason.value && unref(geometry)
        ? appearance.value
        : null,
  }));
  const controls = computed(
    () =>
      ({
        thresholdMaximum: thicknessSliderMaximum(
          measurement.value,
          micronsPerVoxel.value
        ),
        segmentationReason: input.segmentationReason.value,
        highlightReason: input.highlightReason.value,
        thicknessReason: thicknessReason.value,
        segments: input.segmentOptions.value,
      }) satisfies ThicknessControlState
  );
  return { overlay, controls, measuring, message };
}
