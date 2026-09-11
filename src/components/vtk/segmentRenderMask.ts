import type vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import type vtkLabelMap from '@/src/vtk/LabelMap';
import { allocateMask, reframeMaskScalars } from '@/src/store/segmentMask';
import { SEGMENT_VALUE } from '@/src/store/segmentLabelValue';
import {
  clipExtent,
  isEmptyExtent,
  maskScalars,
  padExtent,
  type Extent3D,
} from '@/src/types/segmentation';

// Shared by slice views; never placed in segmentation storage or export inputs.
const renderMasks = new WeakMap<
  vtkLabelMap,
  {
    image: vtkLabelMap;
    key: string;
    mtime: number;
  }
>();

/** Add known background within the scan, without inventing data beyond it. */
export function segmentRenderMask(
  source: vtkLabelMap,
  parent: vtkImageData,
  extent: Extent3D
) {
  if (isEmptyExtent(extent)) return null;
  const padded = clipExtent(
    padExtent(extent, 1),
    parent.getExtent() as Extent3D
  );
  if (padded.every((value, index) => value === extent[index])) {
    renderMasks.delete(source);
    return source;
  }
  const key = [
    ...extent,
    ...padded,
    ...parent.getOrigin(),
    ...parent.getSpacing(),
    ...parent.getDirection(),
  ].join(',');
  let cached = renderMasks.get(source);
  if (!cached || cached.key !== key) {
    cached = { image: allocateMask(parent, padded), key, mtime: -1 };
    renderMasks.set(source, cached);
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
    // Padding guarantees background, and each stored mask is binary. Supplying
    // its exact range avoids a full-volume range scan during slice rendering.
    scalars.setRange(
      { min: 0, max: values.includes(SEGMENT_VALUE) ? SEGMENT_VALUE : 0 },
      0
    );
    cached.image.modified();
    cached.mtime = source.getMTime();
  }
  return cached.image;
}
