import { computed, ref, unref, type MaybeRef } from 'vue';
import { areEquals, dot } from '@kitware/vtk.js/Common/Core/Math';
import type { Vector3 } from '@kitware/vtk.js/types';
import type { useCurrentImage } from '@/src/composables/useCurrentImage';
import { onVTKEvent } from '@/src/composables/onVTKEvent';
import { useSegmentationStore } from '@/src/segmentation/store';
import {
  extentContains,
  extentSize,
  fullExtent,
  isEmptyExtent,
} from '@/src/segmentation/geometry';
import type { OccupiedDepthRequest } from '@/src/segmentation/measurements/useOccupiedDepth';
import type { SlabSpecification } from '@/src/core/slab/types';

export type EnFaceImageSource = Pick<
  ReturnType<typeof useCurrentImage>,
  'currentImageID' | 'currentImageData'
>;

/** Binds one segment's mask and a slab to an occupied-depth request. */
export function useMaskDepthRequest(
  source: EnFaceImageSource,
  slab: MaybeRef<SlabSpecification>,
  segmentId: MaybeRef<string>
) {
  const { currentImageData } = source;
  const segmentationStore = useSegmentationStore();
  // Separate fields keep projection method changes from invalidating requests.
  const slabAxis = computed(() => unref(slab).axis);
  const slabFirst = computed(() => unref(slab).first);
  const slabLast = computed(() => unref(slab).last);
  const volumeRevision = ref(0);
  const maskRevision = ref(0);

  const binding = computed(() => segmentationStore.maskOf(unref(segmentId)));
  const measurementMask = computed(() => {
    void maskRevision.value;
    if (!binding.value) return null;
    const scalars = binding.value.image.getPointData().getScalars();
    const values = scalars?.getData();
    if (
      !(values instanceof Uint8Array) ||
      scalars.getNumberOfComponents() !== 1
    )
      return null;
    return {
      values,
      dimensions: binding.value.image.getDimensions(),
      extent: binding.value.extent,
    };
  });
  const geometryReason = computed(() => {
    void volumeRevision.value;
    void maskRevision.value;
    const parent = currentImageData.value;
    if (!binding.value || !parent) return null;
    const { extent, image } = binding.value;
    const validExtent = extentContains(
      fullExtent(parent.getDimensions()),
      extent
    );
    const direction = parent.getDirection();
    const bases = [0, 1, 2].map((axis) => {
      const offset = axis * 3;
      const basis: Vector3 = [
        direction[offset],
        direction[offset + 1],
        direction[offset + 2],
      ];
      const length = Math.hypot(...basis);
      return Number.isFinite(length) && length > 0
        ? (basis.map((value) => value / length) as Vector3)
        : null;
    });
    const orthogonal = [
      [0, 1],
      [0, 2],
      [1, 2],
    ].every(([a, b]) => {
      const left = bases[a];
      const right = bases[b];
      return (
        left !== null && right !== null && Math.abs(dot(left, right)) < 1e-4
      );
    });
    if (!orthogonal)
      return 'Occupied depth requires an orthogonal source voxel grid.';
    const gridMatches =
      areEquals(image.getDimensions(), extentSize(extent), 1e-5) &&
      areEquals(image.getSpacing(), parent.getSpacing(), 1e-5) &&
      areEquals([...image.getDirection()], [...parent.getDirection()], 1e-5);
    const originMatches = areEquals(
      image.getOrigin(),
      [...parent.indexToWorld([extent[0], extent[2], extent[4]])],
      1e-5
    );
    return validExtent && gridMatches && originMatches
      ? null
      : 'This segmentation mask does not match the source voxel grid; align it to the volume before measuring thickness.';
  });

  // Mask storage changes in place during editing. The volume's voxel values
  // never enter a request, so only its geometry is watched.
  const maskImage = computed(() => binding.value?.image);
  const maskScalars = computed(() => {
    void maskRevision.value;
    return maskImage.value?.getPointData().getScalars();
  });
  onVTKEvent(currentImageData, 'onModified', () => {
    volumeRevision.value += 1;
  });
  onVTKEvent(maskImage, 'onModified', () => {
    maskRevision.value += 1;
  });
  onVTKEvent(maskScalars, 'onModified', () => {
    maskRevision.value += 1;
  });

  const request = computed((): OccupiedDepthRequest | null => {
    void volumeRevision.value;
    const image = currentImageData.value;
    const mask = measurementMask.value;
    if (!image || !mask || isEmptyExtent(mask.extent) || geometryReason.value)
      return null;
    return {
      dimensions: image.getDimensions(),
      source: image,
      segment: unref(segmentId),
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

  return { geometryReason, request };
}
