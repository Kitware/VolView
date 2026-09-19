import type vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import type vtkLabelMap from '@/src/vtk/LabelMap';
import { allocateMask } from '@/src/segmentation/masks/storage';
import { SEGMENT_VALUE } from '@/src/segmentation/masks/labelValue';
import { maskScalars } from '@/src/segmentation/model';
import {
  clipExtent,
  extentReachesSlice,
  isEmptyExtent,
  padExtent,
  reframeMaskScalars,
  type Extent3D,
} from '@/src/segmentation/geometry';

type RenderSlice = {
  source: vtkLabelMap;
  image: vtkLabelMap;
  key: string;
  mtime: number;
};

// Held by one representation, so views on different slices of one axis do not
// evict each other's slice. Kept outside segmentation storage and export.
export type RenderMaskSlot = { slice?: RenderSlice };

// The displayed plane padded with known background, or null off the mask.
function renderExtent(
  extent: Extent3D,
  parent: vtkImageData,
  axis: number,
  slice: number
) {
  if (isEmptyExtent(extent)) return null;
  const index = Math.round(slice);
  if (!extentReachesSlice(extent, axis, index)) return null;
  const padded = clipExtent(
    padExtent(extent, 1),
    parent.getExtent() as Extent3D
  );
  padded[axis * 2] = index;
  padded[axis * 2 + 1] = index;
  return padded;
}

/** Add known background within the scan, without inventing data beyond it. */
export function segmentRenderMask(
  source: vtkLabelMap,
  parent: vtkImageData,
  extent: Extent3D,
  {
    axis,
    index,
    slot = {},
  }: { axis: number; index: number; slot?: RenderMaskSlot }
) {
  const padded = renderExtent(extent, parent, axis, index);
  if (!padded) return null;
  const key = [
    ...extent,
    ...padded,
    ...parent.getOrigin(),
    ...parent.getSpacing(),
    ...parent.getDirection(),
  ].join(',');
  let cached = slot.slice;
  if (!cached || cached.source !== source || cached.key !== key) {
    cached = { source, image: allocateMask(parent, padded), key, mtime: -1 };
    slot.slice = cached;
  }
  if (cached.mtime !== source.getMTime()) {
    const values = reframeMaskScalars(
      maskScalars(source),
      [...extent],
      padded,
      maskScalars(cached.image)
    );
    const scalars = cached.image.getPointData().getScalars();
    scalars.dataChange();
    // Each stored mask is binary. Supply the range to avoid another scan.
    scalars.setRange(
      {
        min: values.includes(0) ? 0 : SEGMENT_VALUE,
        max: values.includes(SEGMENT_VALUE) ? SEGMENT_VALUE : 0,
      },
      0
    );
    cached.image.modified();
    cached.mtime = source.getMTime();
  }
  return cached.image;
}
