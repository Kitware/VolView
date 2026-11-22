import {
  computed,
  markRaw,
  shallowRef,
  toRaw,
  unref,
  watchEffect,
  type Ref,
} from 'vue';
import type vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkLabelMap from '@/src/vtk/LabelMap';
import { useImage } from '@/src/composables/useCurrentImage';
import { useSliceConfig } from '@/src/composables/useSliceConfig';
import { useSegmentStore } from '@/src/segmentation/segments';
import { useMaskRevision } from '@/src/segmentation/composables/useMaskRevision';
import { maskScalars, type SegmentMaskEntry } from '@/src/segmentation/model';
import { arrayEquals, arrayEqualsWithComparator } from '@/src/utils';
import { placeMask, setMaskScalars } from '@/src/segmentation/masks/storage';
import { extentReachesSlice, type Extent3D } from '@/src/segmentation/geometry';
import {
  composeSlice,
  slicePlaneExtent,
  type SlicePlane,
} from '@/src/segmentation/rendering/sliceComposition';
import type { LPSAxis } from '@/src/types/lps';
import type { Maybe } from '@/src/types';

export type RenderedPlane = { image: vtkLabelMap; segmentIds: string[] };

const sameMasks = (a: SegmentMaskEntry[], b: SegmentMaskEntry[]) =>
  arrayEqualsWithComparator(a, b, (x, y) => x.binding === y.binding);

/** One vtk image per plane index, reused while its buffer is. */
function createPlaneImages() {
  let images: vtkLabelMap[] = [];
  const publish = (
    parent: vtkImageData,
    extent: Extent3D,
    planes: SlicePlane[]
  ) => {
    images = planes.map(({ values, segmentIds }, index) => {
      const held = images[index];
      const image =
        held && maskScalars(held) === values
          ? held
          : markRaw(vtkLabelMap.newInstance());
      placeMask(image, parent, extent);
      if (image !== held) setMaskScalars(image, values);
      const scalars = image.getPointData().getScalars();
      scalars.dataChange();
      // Supplying the range skips a scan of the plane.
      scalars.setRange({ min: 0, max: segmentIds.length }, 0);
      image.modified();
      return image;
    });
    return images;
  };
  return { buffers: () => images.map(maskScalars), publish };
}

/**
 * The masks of an image composed into as few label planes as the overlap on
 * the displayed slice allows, recomposed on every voxel write that reaches
 * the slice. Hidden masks keep their labels, which their lookup tables leave
 * transparent, so toggling visibility recomposes nothing.
 */
export function useSegmentSlicePlanes(
  viewId: Ref<string>,
  imageId: Ref<Maybe<string>>,
  axis: Ref<LPSAxis>,
  requestRender: () => void
) {
  const registry = useSegmentStore().segments;
  const imageMasks = computed((previous: SegmentMaskEntry[] = []) => {
    const masks = registry.imageMasks(imageId.value);
    return sameMasks(masks, previous) ? previous : masks;
  });
  const { metadata, imageData: parent } = useImage(imageId);
  const ijkAxis = computed(() => metadata.value?.lpsOrientation[axis.value]);
  const { slice } = useSliceConfig(viewId, imageId);
  // Plain copies of the composed slice: the write listener must not track.
  let shown: { axis: number; index: number } | undefined;
  // Voxel writes inside an unchanged extent are only visible through vtk.
  const revision = useMaskRevision(
    () => imageId.value,
    (region) => !shown || extentReachesSlice(region, shown.axis, shown.index)
  );
  const images = createPlaneImages();
  const planes = shallowRef<RenderedPlane[]>([]);

  const compose = () => {
    const parentImage = parent.value;
    const axisIndex = ijkAxis.value;
    const index = slice.value;
    shown = undefined;
    if (!parentImage || axisIndex === undefined || index == null) return [];
    shown = { axis: axisIndex, index: Math.round(index) };
    const masks = imageMasks.value.map(({ segmentId, binding }) => ({
      id: segmentId,
      // Growth replaces the extent, so reading the raw array still tracks it.
      extent: [...toRaw(binding.extent)] as Extent3D,
      scalars: maskScalars(binding.image),
    }));
    const extent = slicePlaneExtent(
      masks.map((mask) => mask.extent),
      parentImage.getExtent() as Extent3D,
      axisIndex,
      index
    );
    if (!extent) return [];
    const composed = composeSlice(masks, extent, images.buffers());
    return images
      .publish(parentImage, extent, composed)
      .map((image, plane) => ({
        image,
        segmentIds: composed[plane].segmentIds,
      }));
  };

  // Label lists keep their identity across recompositions that keep them.
  let current: RenderedPlane[] = [];
  watchEffect(() => {
    unref(revision);
    current = compose().map((plane, index) => {
      const held = current[index]?.segmentIds;
      return held && arrayEquals(held, plane.segmentIds)
        ? { ...plane, segmentIds: held }
        : plane;
    });
    planes.value = current;
    requestRender();
  });

  return { planes, ijkAxis };
}
