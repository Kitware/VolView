import type vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import type vtkLabelMap from '@/src/vtk/LabelMap';
import {
  allocateMask,
  reframeMaskScalars,
} from '@/src/segmentation/masks/storage';
import { SEGMENT_VALUE } from '@/src/segmentation/masks/labelValue';
import { maskScalars } from '@/src/segmentation/model';
import {
  clipExtent,
  isEmptyExtent,
  padExtent,
  type Extent3D,
} from '@/src/segmentation/geometry';

// Keep only the current slice per axis, outside segmentation storage and export.
const renderMasks = new WeakMap<
  vtkLabelMap,
  Map<
    number,
    {
      image: vtkLabelMap;
      key: string;
      mtime: number;
    }
  >
>();

/** Add known background within the scan, without inventing data beyond it. */
export function segmentRenderMask(
  source: vtkLabelMap,
  parent: vtkImageData,
  extent: Extent3D,
  { axis, index: slice }: { axis: number; index: number }
) {
  if (isEmptyExtent(extent)) return null;
  const padded = clipExtent(
    padExtent(extent, 1),
    parent.getExtent() as Extent3D
  );
  const index = Math.round(slice);
  if (index < extent[axis * 2] || index > extent[axis * 2 + 1]) return null;
  padded[axis * 2] = index;
  padded[axis * 2 + 1] = index;
  const key = [
    ...extent,
    ...padded,
    ...parent.getOrigin(),
    ...parent.getSpacing(),
    ...parent.getDirection(),
  ].join(',');
  let slices = renderMasks.get(source);
  if (!slices) {
    slices = new Map();
    renderMasks.set(source, slices);
  }
  let cached = slices.get(axis);
  if (!cached || cached.key !== key) {
    cached = { image: allocateMask(parent, padded), key, mtime: -1 };
    slices.set(axis, cached);
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
