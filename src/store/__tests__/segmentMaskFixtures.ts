import { nextTick } from 'vue';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import type { TypedArray } from '@kitware/vtk.js/types';

import { useImageCacheStore } from '@/src/store/image-cache';
import { useSegmentationStore } from '@/src/store/segmentations';
import type { Extent3D } from '@/src/types/segmentation';

/** A point in the PARENT image's index space, which is where extents live. */
export type Index3 = [number, number, number];

export const store = () => useSegmentationStore();

export const voxelCount = (dimensions: Index3) =>
  dimensions[0] * dimensions[1] * dimensions[2];

/** The offset an index lands at in a buffer shaped like `dimensions`. */
export const flatIndex =
  (dimensions: Index3) => (i: number, j: number, k: number) =>
    i + j * dimensions[0] + k * dimensions[0] * dimensions[1];

export type SeatOptions = {
  name?: string;
  dimensions?: Index3;
  spacing?: [number, number, number];
  origin?: [number, number, number];
  values?: TypedArray;
};

export async function seatImage(id: string, options: SeatOptions = {}) {
  const {
    name = id,
    dimensions = [4, 4, 4] as Index3,
    spacing = [1, 1, 1],
    origin = [0, 0, 0],
    values,
  } = options;

  const image = vtkImageData.newInstance({ spacing, origin });
  image.setDimensions(dimensions);
  image.getPointData().setScalars(
    vtkDataArray.newInstance({
      numberOfComponents: 1,
      values: values ?? new Uint8Array(voxelCount(dimensions)),
    })
  );
  image.computeTransforms();
  useImageCacheStore().addVTKImageData(image, name, { id });
  await nextTick();
  return image;
}

export const parentImage = (imageId: string) =>
  useImageCacheStore().getVtkImageData(imageId)!;

/** A segment with no storage: adding a segment never allocates voxels. */
export function addSegment(imageId: string, name?: string) {
  const segmentation = store().ensureSegmentationForImage(imageId);
  return store().createSegment(segmentation.id, name ? { name } : undefined).id;
}

export const bindingOf = (segmentId: string) =>
  store().segmentVoxels(segmentId).binding();

export const extentOf = (segmentId: string) => bindingOf(segmentId)?.extent;

export const labelValueOf = (segmentId: string) =>
  bindingOf(segmentId)?.labelValue;

const containsIndex = (extent: Extent3D, [i, j, k]: Index3) =>
  i >= extent[0] &&
  i <= extent[1] &&
  j >= extent[2] &&
  j <= extent[3] &&
  k >= extent[4] &&
  k <= extent[5];

/** The mask offset a parent index maps to, or undefined when it is outside. */
function offsetOf(segmentId: string, index: Index3) {
  const binding = bindingOf(segmentId);
  if (!binding || !containsIndex(binding.extent, index)) return undefined;
  const dimensions = store().segmentVoxels(segmentId).image().getDimensions();
  const { extent } = binding;
  return (
    index[0] -
    extent[0] +
    (index[1] - extent[2]) * dimensions[0] +
    (index[2] - extent[4]) * dimensions[0] * dimensions[1]
  );
}

/**
 * The segment's voxel value at a PARENT index, or undefined when that index is
 * outside the mask. Reads through the binding's extent, so it says the same
 * thing whatever the mask's own bounds are.
 */
export function maskValueAt(segmentId: string, index: Index3) {
  const offset = offsetOf(segmentId, index);
  if (offset === undefined) return undefined;
  return store().segmentVoxels(segmentId).scalars()[offset];
}

/** Marks one parent-index voxel for a segment, through the growth path. */
export function seedVoxel(segmentId: string, index: Index3, value?: number) {
  const voxels = store().segmentVoxels(segmentId);
  const binding = voxels.materialize();
  voxels.ensureContains([
    index[0],
    index[0],
    index[1],
    index[1],
    index[2],
    index[2],
  ]);
  const offset = offsetOf(segmentId, index)!;
  voxels.scalars()[offset] = value ?? binding.labelValue;
  voxels.image().modified();
}

/**
 * Every marked voxel of a segment as `[i, j, k, value]` in PARENT index space,
 * so two masks with different bounds are still comparable.
 */
export function markedVoxels(segmentId: string) {
  const binding = bindingOf(segmentId);
  if (!binding) return undefined;
  const voxels = store().segmentVoxels(segmentId);
  const [di, dj, dk] = voxels.image().getDimensions();
  const scalars = voxels.scalars();
  const marks: Array<[number, number, number, number]> = [];
  for (let k = 0; k < dk; k += 1) {
    for (let j = 0; j < dj; j += 1) {
      for (let i = 0; i < di; i += 1) {
        const value = scalars[i + j * di + k * di * dj];
        if (value !== 0) {
          marks.push([
            i + binding.extent[0],
            j + binding.extent[2],
            k + binding.extent[4],
            value,
          ]);
        }
      }
    }
  }
  return marks;
}
