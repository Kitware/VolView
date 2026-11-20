import { computed, ref, unref, type MaybeRef } from 'vue';
import { onVTKEvent } from '@/src/composables/onVTKEvent';
import type { SlabSpecification } from '@/src/core/slab/types';
import { getOccupiedDepthSupport } from './occupiedDepthSupport';
import type { EnFaceImageSource } from './useMaskDepthRequest';

/** Physical voxel depth along the slab axis, or why thickness cannot be measured. */
export function useThinCalibration(
  { currentImageID, currentImageData }: EnFaceImageSource,
  slab: MaybeRef<SlabSpecification>
) {
  const revision = ref(0);
  onVTKEvent(currentImageData, 'onModified', () => {
    revision.value += 1;
  });
  const axis = computed(() => unref(slab).axis);
  const support = computed(() => {
    void revision.value;
    return getOccupiedDepthSupport(currentImageID.value);
  });
  const micronsPerVoxel = computed(() => {
    void revision.value;
    const image = currentImageData.value;
    if (!image) return 0;
    // Declared DICOM spacing is physical, so rounded unit cosines must not
    // rescale it. Generic image directions can carry scale.
    const scale = support.value.calibratedAxes?.[axis.value]
      ? 1
      : Math.hypot(
          ...image.getDirection().slice(axis.value * 3, axis.value * 3 + 3)
        );
    return Math.abs(image.getSpacing()[axis.value]) * scale * 1000;
  });
  const reason = computed(
    () =>
      support.value.reason ||
      (support.value.calibratedAxes?.[axis.value] === false
        ? 'The projection axis has no reliable declared voxel spacing; occupied depth is unavailable.'
        : null) ||
      (!Number.isFinite(micronsPerVoxel.value) || micronsPerVoxel.value <= 0
        ? 'The projection axis has invalid voxel spacing; occupied depth is unavailable.'
        : null)
  );
  return { micronsPerVoxel, reason };
}
