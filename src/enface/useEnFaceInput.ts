import { computed, reactive, ref, unref, watch, type MaybeRef } from 'vue';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { onVTKEvent } from '@/src/composables/onVTKEvent';
import { useSegmentationStore } from '@/src/segmentation/store';
import { useSegmentStore } from '@/src/segmentation/segments';
import { extentSize, isEmptyExtent } from '@/src/segmentation/geometry';
import { getEnFaceAvailability } from './availability';
import { defaultEnFaceViewConfig, useEnFaceViewStore } from './store';
import { getSourceValidity } from '@/src/core/slab/sourceValidity';
import { deriveSlabGeometry } from '@/src/core/slab/geometry';
import { get2DOrientationForSourceAxis } from '@/src/utils/getViewingVectors';
import type { OccupiedDepthRequest } from '@/src/segmentation/measurements/useOccupiedDepth';

export function useEnFaceInput(viewId: MaybeRef<string>) {
  const source = useCurrentImage();
  const { currentImageID, currentImageData, currentImageMetadata } = source;
  const segmentationStore = useSegmentationStore();
  const segmentsRegistry = useSegmentStore().segments;
  const enFaceStore = useEnFaceViewStore();
  const emptySettings = reactive(defaultEnFaceViewConfig());
  const settings = computed(() =>
    currentImageID.value
      ? enFaceStore.configFor(unref(viewId), currentImageID.value)
      : emptySettings
  );
  const volumeRevision = ref(0);
  const maskRevision = ref(0);
  const availability = computed(() => {
    void volumeRevision.value;
    return getEnFaceAvailability(currentImageID.value);
  });
  const projectionReason = computed(() => availability.value.reason);
  const dimensions = computed(() => {
    void volumeRevision.value;
    return currentImageData.value?.getDimensions() ?? [1, 1, 1];
  });
  const depthMaximum = computed(() =>
    Math.max(0, dimensions.value[settings.value.axis] - 1)
  );
  const orientation = computed(() =>
    get2DOrientationForSourceAxis(
      settings.value.axis,
      currentImageMetadata.value.lpsOrientation
    )
  );
  const axisOptions = computed(() =>
    (['Axial', 'Coronal', 'Sagittal'] as const).map((axis) => ({
      title: axis,
      value: currentImageMetadata.value.lpsOrientation[axis],
    }))
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
  watch(
    [
      settings,
      projectionReason,
      currentImageData,
      depthMaximum,
      () => settings.value.depthStart,
      () => settings.value.depthEnd,
    ],
    ([config, reason, image]) => {
      if (reason || !image) return;
      const start = depthStart.value;
      const end = config.depthEnd === null ? null : depthEnd.value;
      if (config.depthStart !== start) config.depthStart = start;
      if (config.depthEnd !== end) config.depthEnd = end;
    },
    { immediate: true, flush: 'sync' }
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
        ? 'Load or create a segmentation mask associated with this volume.'
        : null)
  );
  const maskStorageReason = computed(() => {
    void maskRevision.value;
    const binding = selectedBinding.value;
    if (!binding)
      return 'The selected segment voxels are not available; load or create its mask to measure occupied depth.';
    if (isEmptyExtent(binding.extent))
      return 'The selected segment has no occupied voxels to measure.';
    const scalars = binding.image.getPointData().getScalars();
    if (
      !scalars ||
      !(scalars.getData() instanceof Uint8Array) ||
      scalars.getNumberOfComponents() !== 1
    )
      return 'The selected segment does not have a supported binary voxel mask.';
    return null;
  });
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
    const direction = parent.getDirection();
    const bases = [0, 1, 2].map((axis) =>
      Array.from(direction).slice(axis * 3, axis * 3 + 3)
    );
    const orthogonal = [
      [0, 1],
      [0, 2],
      [1, 2],
    ].every(
      ([a, b]) =>
        Math.abs(
          bases[a].reduce(
            (sum, value, index) => sum + value * bases[b][index],
            0
          )
        ) < 1e-4
    );
    if (!orthogonal)
      return 'Occupied depth requires an orthogonal source voxel grid.';
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
      : 'This segmentation mask does not match the source voxel grid; align it to the volume before measuring thickness.';
  });
  const micronsPerVoxel = computed(() => {
    void volumeRevision.value;
    const image = currentImageData.value;
    if (!image) return 0;
    const axis = settings.value.axis;
    const direction = image.getDirection();
    const offset = axis * 3;
    const directionLength = Math.hypot(
      direction[offset],
      direction[offset + 1],
      direction[offset + 2]
    );
    // DICOM direction cosines describe unit vectors; rounded values retain
    // their declared spacing. Generic image directions can also carry scale.
    const scale =
      availability.value.calibratedAxes?.[axis] &&
      Math.abs(directionLength - 1) <= (axis === 2 ? 2e-4 : 1e-4)
        ? 1
        : directionLength;
    return Math.abs(image.getSpacing()[axis]) * scale * 1000;
  });
  const highlightEligibilityReason = computed(
    () =>
      segmentationReason.value ||
      availability.value.paddingReason ||
      availability.value.measurementGeometryReason ||
      (availability.value.calibratedAxes?.[settings.value.axis] === false
        ? 'The projection axis has no reliable declared voxel spacing; occupied depth is unavailable.'
        : null) ||
      (!Number.isFinite(micronsPerVoxel.value) || micronsPerVoxel.value <= 0
        ? 'The projection axis has invalid voxel spacing; occupied depth is unavailable.'
        : null)
  );
  const thicknessReason = computed(
    () =>
      highlightEligibilityReason.value ||
      maskStorageReason.value ||
      maskGeometryReason.value
  );

  // Scalar and mask storage can change in place during streaming or segmentation editing.
  const volumeScalars = computed(() => {
    void volumeRevision.value;
    return currentImageData.value?.getPointData().getScalars();
  });
  const maskImage = computed(() => selectedBinding.value?.image);
  const maskScalars = computed(() => {
    void maskRevision.value;
    return maskImage.value?.getPointData().getScalars();
  });
  onVTKEvent(currentImageData, 'onModified', () => {
    volumeRevision.value += 1;
  });
  onVTKEvent(volumeScalars, 'onModified', () => {
    volumeRevision.value += 1;
  });
  onVTKEvent(maskImage, 'onModified', () => {
    maskRevision.value += 1;
  });

  onVTKEvent(maskScalars, 'onModified', () => {
    maskRevision.value += 1;
  });

  const specification = computed(() => ({
    axis: settings.value.axis,
    first: depthStart.value,
    last: depthEnd.value,
    method: settings.value.method,
  }));
  const geometry = computed(() => {
    void volumeRevision.value;
    const image = currentImageData.value;
    return image && !projectionReason.value
      ? deriveSlabGeometry(image, specification.value)
      : null;
  });
  const measurementMask = computed(() => {
    void maskRevision.value;
    const binding = selectedBinding.value;
    if (!binding) return null;
    const scalars = binding.image.getPointData().getScalars();
    const values = scalars?.getData();
    if (
      !(values instanceof Uint8Array) ||
      scalars.getNumberOfComponents() !== 1
    )
      return null;
    return {
      values,
      dimensions: binding.image.getDimensions(),
      extent: [...binding.extent],
    };
  });
  const validityExtent = computed(() => {
    const mask = measurementMask.value;
    if (!mask) return '';
    const extent = [...mask.extent];
    const offset = settings.value.axis * 2;
    extent[offset] = Math.max(extent[offset], depthStart.value);
    extent[offset + 1] = Math.min(extent[offset + 1], depthEnd.value);
    return JSON.stringify(extent);
  });
  const measurementValidity = computed(() => {
    if (!settings.value.highlightThin || !validityExtent.value)
      return undefined;
    void volumeRevision.value;
    const image = currentImageData.value;
    return image
      ? getSourceValidity(
          image,
          availability.value.paddingRanges ?? [],
          JSON.parse(validityExtent.value)
        )
      : undefined;
  });
  watch(
    () => settings.value.highlightThin,
    (enabled) => {
      if (!enabled) void measurementValidity.value;
    }
  );
  const measurementRequest = computed((): OccupiedDepthRequest | null => {
    if (!settings.value.highlightThin) return null;
    void volumeRevision.value;
    const image = currentImageData.value;
    const mask = measurementMask.value;
    if (!image || !mask || thicknessReason.value) return null;
    return {
      dimensions: image.getDimensions(),
      source: image,
      segment: settings.value.selectedMaskId!,
      grid: JSON.stringify([
        image.getOrigin(),
        image.getSpacing(),
        image.getDirection(),
      ]),
      validity: measurementValidity.value,
      axis: settings.value.axis,
      first: depthStart.value,
      last: depthEnd.value,
      mask,
    };
  });

  const controls = computed(() => ({
    axisOptions: axisOptions.value,
    depthMaximum: depthMaximum.value,
    segmentOptions: segmentOptions.value,
    projectionReason: projectionReason.value,
    segmentationReason: segmentationReason.value,
    highlightEligibilityReason: highlightEligibilityReason.value,
    thicknessReason: thicknessReason.value,
  }));
  return {
    source,
    orientation,
    settings,
    controls,
    specification,
    geometry,
    measurementRequest,
    micronsPerVoxel,
  };
}
