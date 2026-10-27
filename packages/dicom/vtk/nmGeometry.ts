import {
  DicomDataset,
  readGeometryFacts,
  sliceNormalOf,
  type Reconstruction,
} from '../core/index';
import { readNmReconstruction } from '../core/metadata/nmReconstruction';

export function nmGeometry(metadata: DicomDataset) {
  const nm = readNmReconstruction(metadata);
  if (!nm) return null;
  if ('error' in nm) throw new Error(nm.error);
  const geometry = readGeometryFacts(metadata);
  const normal = sliceNormalOf(geometry.orientation);
  if (!normal || !geometry.position || !geometry.pixelSpacing)
    throw new Error(
      'Cannot allocate NM volume without readable patient geometry'
    );
  const step = nm.sliceSpacing || 1;
  const direction = normal.map((value) => value * Math.sign(step));
  const reconstruction: Reconstruction = {
    kind: 'regular',
    sliceSpacing: nm.sliceSpacing ? Math.abs(nm.sliceSpacing) : null,
    slots: [0],
  };
  return { ...geometry, direction, reconstruction };
}
