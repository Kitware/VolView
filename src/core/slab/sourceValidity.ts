import type vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import type { SlabPaddingRange } from './types';

type CachedValidity = {
  revision: string;
  values: ArrayLike<number>;
  validity: Uint8Array;
};

const sources = new WeakMap<vtkImageData, CachedValidity>();

/** Source support for measurements; unmarked zero values remain valid. */
export function getSourceValidity(
  image: vtkImageData,
  padding: readonly SlabPaddingRange[] = []
) {
  if (!padding.length) return undefined;
  const scalars = image.getPointData().getScalars();
  const values = scalars.getData();
  const dimensions = image.getDimensions();
  const revision = JSON.stringify([
    image.getMTime(),
    scalars.getMTime(),
    dimensions,
    padding,
  ]);
  const previous = sources.get(image);
  if (previous?.revision === revision && previous.values === values)
    return previous.validity;
  const validity = new Uint8Array(values.length).fill(1);
  const frameSize = dimensions[0] * dimensions[1];
  for (const range of padding) {
    const first = range.firstFrame * frameSize;
    const last = (range.lastFrame + 1) * frameSize;
    for (let index = first; index < last; index++) {
      if (values[index] >= range.min && values[index] <= range.max)
        validity[index] = 0;
    }
  }
  sources.set(image, { revision, values, validity });
  return validity;
}
