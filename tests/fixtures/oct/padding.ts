import reference from './reference.json';
import {
  createSyntheticOCT,
  syntheticScalars,
  type Part10Options,
} from './dicom';

const PADDING = 65535;

/** Declared missing data over two B-scan columns and one voxel; original intensity elsewhere. */
export function paddedSyntheticOCT(options: Part10Options = {}) {
  const [width, depth] = reference.size;
  const scalars = syntheticScalars();
  const voxel = (x: number, y: number, z: number) =>
    (z * depth + y) * width + x;
  for (const [x, z] of [
    [0, 0],
    [5, 12],
  ]) {
    for (let y = 0; y < depth; y++) scalars[voxel(x, y, z)] = PADDING;
  }
  scalars[voxel(10, 0, 10)] = PADDING;
  return createSyntheticOCT({
    ...options,
    scalars,
    pixelPaddingValue: PADDING,
  });
}
