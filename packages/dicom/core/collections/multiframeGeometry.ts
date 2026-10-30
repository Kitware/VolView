import type { DicomDataset } from '../metadata/dicomDataset';
import { readGeometryFacts, sliceNormalOf } from './instanceFacts';
import { reconstructVolume, type Reconstruction } from './reconstructVolume';
import { ORIENTATION_TOLERANCE } from './planDicomCollections';
import { getDatasetTag } from '../metadata/datasetAccess';
import { trimDicomPadding } from '../utils';
import { perFrameGroups, sequenceItems } from '../metadata/functionalGroups';

const dot = (left: number[], right: number[]) =>
  left.reduce((sum, value, index) => sum + value * right[index], 0);

const orientationsAgree = (left: number[] | null, right: number[] | null) =>
  left !== null &&
  right !== null &&
  dot(left.slice(0, 3), right.slice(0, 3)) >= 1 - ORIENTATION_TOLERANCE &&
  dot(left.slice(3), right.slice(3)) >= 1 - ORIENTATION_TOLERANCE;

function storageDirection(frames: ReturnType<typeof readGeometryFacts>[]) {
  const first = frames[0];
  const normal = sliceNormalOf(first.orientation);
  const last = frames.at(-1)!.position;
  const delta = first.position?.map((value, index) =>
    last ? last[index] - value : 0
  );
  const sign = normal && delta && dot(normal, delta) < 0 ? -1 : 1;
  return normal?.map((value) => value * sign) ?? null;
}

const singleSpatialStack = (groups: DicomDataset[]) =>
  ['00209056', '00209128'].every((tag) => {
    const values = groups
      .map((group) =>
        trimDicomPadding(
          getDatasetTag(sequenceItems(group, '00209111')[0], tag) ?? ''
        )
      )
      .filter(Boolean);
    return new Set(values).size <= 1;
  });

/**
 * Patient-space frames keep their stored pixel order. The third direction
 * follows the positions, which can run opposite the row/column cross product.
 * Ophthalmic scan-line coordinates require a separate calibrated localizer;
 * optical SliceThickness cannot substitute for their separation.
 */
export function multiframeGeometry(metadata: DicomDataset, count: number) {
  const groups = perFrameGroups(metadata);
  const shared = sequenceItems(metadata, '52009229');
  if (count < 2 || (shared.length === 0 && groups.length === 0)) return null;
  const frames = Array.from({ length: count }, (_, index) =>
    readGeometryFacts(metadata, index)
  );
  const first = frames[0];
  const direction = storageDirection(frames);
  const reconstruction = reconstructVolume(frames, direction);
  const readable =
    groups.length === count &&
    singleSpatialStack(groups) &&
    frames.every(
      (frame) =>
        frame.pixelSpacing !== null &&
        orientationsAgree(first.orientation, frame.orientation)
    );
  const validated: Reconstruction = readable
    ? reconstruction
    : {
        kind: 'irregular',
        reason: 'unreadable-geometry',
        sliceSpacing: reconstruction.sliceSpacing,
        slots: [0],
      };
  return {
    ...first,
    direction,
    sliceSpacingSource: 'ImagePositionPatient',
    reconstruction: { ...validated, slots: [0] },
  };
}
