import { computed, reactive, ref, unref, watch, type MaybeRef } from 'vue';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { onVTKEvent } from '@/src/composables/onVTKEvent';
import { useSegmentationStore } from '@/src/segmentation/store';
import { useSegmentStore } from '@/src/segmentation/segments';
import { extentSize } from '@/src/segmentation/geometry';
import { getOCTAvailability } from './availability';
import { defaultOCTViewConfig, useOCTViewStore } from './store';
import type { ProjectionInput } from './types';

export function useEnFaceInput(viewId: MaybeRef<string>) {
  const source = useCurrentImage();
  const { currentImageID, currentImageData } = source;
  const segmentationStore = useSegmentationStore();
  const segmentsRegistry = useSegmentStore().segments;
  const octStore = useOCTViewStore();
  const emptySettings = reactive(defaultOCTViewConfig());
  const settings = computed(() =>
    currentImageID.value
      ? octStore.configFor(unref(viewId), currentImageID.value)
      : emptySettings
  );
  const availability = computed(() => getOCTAvailability(currentImageID.value));
  const projectionReason = computed(() => availability.value.reason);
  const dimensions = computed(
    () => currentImageData.value?.getDimensions() ?? [1, 1, 1]
  );
  const depthMaximum = computed(() =>
    Math.max(0, dimensions.value[settings.value.axis] - 1)
  );
  const depthStart = computed(() =>
    Math.min(depthMaximum.value, Math.max(0, settings.value.depthStart))
  );
  const depthEnd = computed(() =>
    Math.max(
      depthStart.value,
      Math.min(
        depthMaximum.value,
        settings.value.depthEnd ?? depthMaximum.value
      )
    )
  );

  const segmentOptions = computed(() => {
    if (!currentImageID.value) return [];
    return segmentationStore
      .boundMaskIds(currentImageID.value)
      .map((maskId) => {
        const mask = segmentationStore.getMask(maskId);
        const appearance = segmentsRegistry.appearanceOf(mask.segmentId);
        return {
          value: maskId,
          title: appearance.displayName,
          color: appearance.cssColor,
        };
      });
  });
  watch(
    [settings, segmentOptions],
    ([config, options]) => {
      if (!options.some((option) => option.value === config.selectedMaskId)) {
        if (config.selectedMaskId) config.highlightThin = false;
        config.selectedMaskId = options[0]?.value ?? null;
      }
    },
    { immediate: true }
  );
  const selectedBinding = computed(() =>
    settings.value.selectedMaskId
      ? segmentationStore.findMaskBinding(settings.value.selectedMaskId)
      : undefined
  );
  const segmentationReason = computed(
    () =>
      projectionReason.value ||
      (!segmentOptions.value.length
        ? 'Load or create a segmentation mask associated with this OCT volume.'
        : null)
  );
  const volumeRevision = ref(0);
  const maskRevision = ref(0);
  function arraysNear(left: ArrayLike<number>, right: ArrayLike<number>) {
    return (
      left.length === right.length &&
      Array.from(left).every(
        (value, index) => Math.abs(value - right[index]) < 1e-5
      )
    );
  }
  const maskGeometryReason = computed(() => {
    void volumeRevision.value;
    void maskRevision.value;
    const binding = selectedBinding.value;
    const parent = currentImageData.value;
    if (!binding || !parent) return null;
    const extent = binding.extent;
    const validExtent = extent.every(
      (value, index) =>
        Number.isInteger(value) &&
        value >= 0 &&
        value < dimensions.value[Math.floor(index / 2)]
    );
    const gridMatches =
      arraysNear(binding.image.getDimensions(), extentSize(extent)) &&
      arraysNear(binding.image.getSpacing(), parent.getSpacing()) &&
      arraysNear(binding.image.getDirection(), parent.getDirection());
    const originMatches = arraysNear(
      binding.image.getOrigin(),
      parent.indexToWorld([extent[0], extent[2], extent[4]])
    );
    return validExtent && gridMatches && originMatches
      ? null
      : 'This segmentation mask does not match the OCT voxel grid; align it to the volume before measuring thickness.';
  });
  const highlightEligibilityReason = computed(
    () =>
      segmentationReason.value ||
      (!availability.value.calibratedAxes[settings.value.axis]
        ? 'Physical units or spacing for this A-line axis are unavailable; thickness in micrometers is unavailable.'
        : null)
  );
  const thicknessReason = computed(
    () => highlightEligibilityReason.value || maskGeometryReason.value
  );

  // Scalar and mask storage can change in place during streaming or segmentation editing.
  const volumeScalars = computed(() =>
    currentImageData.value?.getPointData().getScalars()
  );
  const maskImage = computed(() => selectedBinding.value?.image);
  onVTKEvent(currentImageData, 'onModified', () => {
    volumeRevision.value += 1;
  });
  onVTKEvent(volumeScalars, 'onModified', () => {
    volumeRevision.value += 1;
  });
  onVTKEvent(maskImage, 'onModified', () => {
    maskRevision.value += 1;
  });

  const retryRevision = ref(0);
  const request = computed(() => {
    // Track VTK events even though the underlying arrays are intentionally raw.
    void volumeRevision.value;
    void maskRevision.value;
    void retryRevision.value;
    if (
      projectionReason.value ||
      !currentImageData.value ||
      !volumeScalars.value
    )
      return null;
    const input: ProjectionInput = {
      volume: {
        scalars: volumeScalars.value.getData(),
        dimensions: [...dimensions.value],
        spacing: currentImageData.value.getSpacing().map(Math.abs),
        numberOfComponents: volumeScalars.value.getNumberOfComponents(),
        paddingRanges: availability.value.paddingRanges,
      },
      axis: settings.value.axis,
      method: settings.value.method,
      depthStart: depthStart.value,
      depthEnd: depthEnd.value,
    };
    const binding = selectedBinding.value;
    if (binding && !thicknessReason.value) {
      const scalars = binding.image.getPointData().getScalars();
      input.segmentation = {
        scalars: scalars.getData(),
        dimensions: [...binding.image.getDimensions()],
        extent: [...binding.extent],
        numberOfComponents: scalars.getNumberOfComponents(),
      };
    }
    return input;
  });

  const controls = computed(() => ({
    depthMaximum: depthMaximum.value,
    segmentOptions: segmentOptions.value,
    projectionReason: projectionReason.value,
    segmentationReason: segmentationReason.value,
    highlightEligibilityReason: highlightEligibilityReason.value,
    thicknessReason: thicknessReason.value,
  }));
  const retry = () => {
    retryRevision.value += 1;
  };
  return { source, settings, controls, request, retry };
}
