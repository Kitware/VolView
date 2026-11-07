import { DicomDataset } from '../core/metadata/dicomDataset';
import {
  readGeometryFacts,
  sliceNormalOf,
} from '../core/collections/instanceFacts';
import { type Reconstruction } from '../core/collections/reconstructVolume';
import { readNmReconstruction } from '../core/metadata/nmReconstruction';

export function nmGeometry(metadata: DicomDataset) {
  const nm = readNmReconstruction(metadata);
  if (!nm) return null;
  if ('error' in nm) throw new Error(nm.error);
  const geometry = readGeometryFacts(metadata);
  const normal = sliceNormalOf(geometry.orientation);
  const step = nm.sliceSpacing || 1;
  const direction = normal?.map((value) => value * Math.sign(step)) ?? null;
  const reconstruction: Reconstruction = {
    kind: 'regular',
    sliceSpacing: nm.sliceSpacing ? Math.abs(nm.sliceSpacing) : null,
    slots: [0],
  };
  return {
    ...geometry,
    direction,
    reconstruction,
    sliceSpacingSource: 'SpacingBetweenSlices',
  };
}
