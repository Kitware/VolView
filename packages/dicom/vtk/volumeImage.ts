import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import type { Vector3 } from '@kitware/vtk.js/types';
import type { mat3 } from 'gl-matrix';
import { loadedRange, type Volume } from '../core/volume/allocateVolume';
import type { VolumeUpdate } from '../core/volume/loadVolume';
import { sliceToThumbnail, thumbnailRange } from './thumbnail';

// Volume rendering needs a range before the first slice decodes.
const PLACEHOLDER_RANGE = { min: 0, max: 255 };
const placeholders = new WeakSet<object>();

/** Wraps the volume's buffer in a vtkImageData; the two share memory. */
export function toVtkImageData(volume: Volume) {
  const { dimensions, components } = volume;
  const image = vtkImageData.newInstance();
  image.setDimensions([...dimensions]);
  image.setOrigin([...volume.origin] as Vector3);
  image.setSpacing([...volume.spacing]);
  image.setDirection(volume.direction as mat3);
  const scalars = vtkDataArray.newInstance({
    numberOfComponents: components,
    values: volume.data,
  });
  image.getPointData().setScalars(scalars);
  const ranges = loadedRange(volume);
  if (ranges.length === 0) {
    scalars.setRange(PLACEHOLDER_RANGE, 0);
    placeholders.add(scalars);
  }
  ranges.forEach(([min, max], component) =>
    scalars.setRange({ min, max }, component)
  );
  return image;
}

/** Widens the scalar range by a decoded slice and marks the image modified. */
export function applyVolumeUpdate(image: vtkImageData, update: VolumeUpdate) {
  if ('error' in update) return;
  const scalars = image.getPointData().getScalars();
  // Slices may load faster than updates are applied, so the placeholder is
  // tracked rather than inferred from the loaded count.
  const replace = placeholders.delete(scalars);
  update.range.forEach(([min, max], component) => {
    const [low, high] = replace
      ? [min, max]
      : (scalars.getRange(component) as [number, number]);
    scalars.setRange(
      { min: Math.min(low, min), max: Math.max(high, max) },
      component
    );
  });
  scalars.modified();
  image.modified();
}

/** An 8 bit thumbnail of one loaded slice, windowed to the loaded range. */
export function sliceThumbnail(image: vtkImageData, slice: number) {
  const scalars = image.getPointData().getScalars();
  const components = scalars.getNumberOfComponents();
  const [width, height] = image.getDimensions();
  const samplesPerSlice = width * height * components;
  const data = scalars.getData();
  return sliceToThumbnail({
    data: data.subarray(slice * samplesPerSlice, (slice + 1) * samplesPerSlice),
    width,
    height,
    components,
    range:
      components >= 3
        ? thumbnailRange(data, components)
        : (scalars.getRange(0) as [number, number]),
  });
}
