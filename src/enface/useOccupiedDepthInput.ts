import { computed, ref, unref, watch, type MaybeRef } from 'vue';
import type { useCurrentImage } from '@/src/composables/useCurrentImage';
import { onVTKEvent } from '@/src/composables/onVTKEvent';
import { useSegmentationStore } from '@/src/segmentation/store';
import { useSegmentStore } from '@/src/segmentation/segments';
import { extentSize, isEmptyExtent } from '@/src/segmentation/geometry';
import type { OccupiedDepthRequest } from '@/src/segmentation/measurements/useOccupiedDepth';
import type { SlabSpecification } from '@/src/core/slab/types';
import { getOccupiedDepthSupport } from './occupiedDepthSupport';
import { useEnFaceViewStore } from './store';

function arraysNear(left: ArrayLike<number>, right: ArrayLike<number>) {
  return (
    left.length === right.length &&
    Array.from(left).every(
      (value, index) => Math.abs(value - right[index]) < 1e-5
    )
  );
}

export type OccupiedDepthProjection = {
  source: Pick<
    ReturnType<typeof useCurrentImage>,
    'currentImageID' | 'currentImageData'
  >;
  slab: MaybeRef<SlabSpecification>;
  /** Blocks every thickness control, such as an unavailable projection. */
  blockedReason: MaybeRef<string | null>;
};

/** Binds the selected segment mask and calibrated slab to a measurement request. */
export function useOccupiedDepthInput(
  viewId: MaybeRef<string>,
  { source, slab, blockedReason }: OccupiedDepthProjection
) {
  const { currentImageID, currentImageData } = source;
  const segmentationStore = useSegmentationStore();
  const segmentsRegistry = useSegmentStore().segments;
  const enFaceStore = useEnFaceViewStore();
  const settings = computed(() =>
    enFaceStore.settingsFor(unref(viewId), currentImageID.value)
  );
  // Separate fields keep projection method changes from invalidating requests.
  const slabAxis = computed(() => unref(slab).axis);
  const slabFirst = computed(() => unref(slab).first);
  const slabLast = computed(() => unref(slab).last);
  const volumeRevision = ref(0);
  const maskRevision = ref(0);
  const support = computed(() => {
    void volumeRevision.value;
    return getOccupiedDepthSupport(currentImageID.value);
  });
  const dimensions = computed(() => {
    void volumeRevision.value;
    return currentImageData.value?.getDimensions() ?? [1, 1, 1];
  });

  const segmentOptions = computed(() => {
    if (!currentImageID.value) return [];
    const segmentIds = segmentationStore
      .imageMasks(currentImageID.value)
      .map((mask) => mask.segmentId);
    const selected = segmentsRegistry.getSegment(
      settings.value.selectedSegmentId
    );
    // A restored segment can precede its mask record and decoded voxels.
    if (selected && !segmentIds.includes(selected.id))
      segmentIds.push(selected.id);
    return segmentIds.map((segmentId) => {
      const appearance = segmentsRegistry.appearanceOf(segmentId);
      return {
        value: segmentId,
        title: appearance.displayName,
        color: appearance.cssColor,
      };
    });
  });
  watch(
    [settings, segmentOptions],
    ([config, options]) => {
      if (
        !options.some((option) => option.value === config.selectedSegmentId)
      ) {
        if (config.selectedSegmentId) config.highlightThin = false;
        config.selectedSegmentId = options[0]?.value ?? null;
      }
    },
    { immediate: true }
  );
  const selectedMask = computed(() =>
    segmentationStore.maskFor(
      currentImageID.value,
      settings.value.selectedSegmentId
    )
  );
  const selectedBinding = computed(() =>
    selectedMask.value
      ? segmentationStore.findMaskBinding(selectedMask.value.id)
      : undefined
  );
  const segmentationReason = computed(
    () =>
      unref(blockedReason) ||
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
    const direction = image.getDirection();
    const offset = slabAxis.value * 3;
    const directionLength = Math.hypot(
      direction[offset],
      direction[offset + 1],
      direction[offset + 2]
    );
    // DICOM direction cosines describe unit vectors; rounded values retain
    // their declared spacing. Generic image directions can also carry scale.
    const scale =
      support.value.calibratedAxes?.[slabAxis.value] &&
      Math.abs(directionLength - 1) <= (slabAxis.value === 2 ? 2e-4 : 1e-4)
        ? 1
        : directionLength;
    return Math.abs(image.getSpacing()[slabAxis.value]) * scale * 1000;
  });
  const highlightReason = computed(
    () =>
      segmentationReason.value ||
      (!selectedBinding.value ? maskStorageReason.value : null) ||
      support.value.reason ||
      (support.value.calibratedAxes?.[slabAxis.value] === false
        ? 'The projection axis has no reliable declared voxel spacing; occupied depth is unavailable.'
        : null) ||
      (!Number.isFinite(micronsPerVoxel.value) || micronsPerVoxel.value <= 0
        ? 'The projection axis has invalid voxel spacing; occupied depth is unavailable.'
        : null)
  );
  const thicknessReason = computed(
    () =>
      highlightReason.value ||
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
  const request = computed((): OccupiedDepthRequest | null => {
    if (!settings.value.highlightThin) return null;
    void volumeRevision.value;
    const image = currentImageData.value;
    const mask = measurementMask.value;
    if (!image || !mask || thicknessReason.value) return null;
    return {
      dimensions: image.getDimensions(),
      source: image,
      segment: selectedMask.value!.id,
      grid: JSON.stringify([
        image.getOrigin(),
        image.getSpacing(),
        image.getDirection(),
      ]),
      axis: slabAxis.value,
      first: slabFirst.value,
      last: slabLast.value,
      mask,
    };
  });

  return {
    settings,
    selectedMask,
    segmentOptions,
    segmentationReason,
    highlightReason,
    thicknessReason,
    micronsPerVoxel,
    request,
  };
}
