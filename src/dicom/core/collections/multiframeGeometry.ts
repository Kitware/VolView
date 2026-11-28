import type { DicomDataset } from '../metadata/dicomDataset';
import { readGeometryFacts, sliceNormalOf } from './instanceFacts';
import { reconstructVolume, type Reconstruction } from './reconstructVolume';
import { dot, orientationsAgree } from './orientation';
import { getDatasetTag } from '../metadata/datasetAccess';
import { trimDicomPadding } from '../utils';
import {
  perFrameGroups,
  sequenceItems,
  SHARED_GROUPS,
} from '../metadata/functionalGroups';

const FRAME_CONTENT = '00209111';
const STACK_ID = '00209056';
const TEMPORAL_POSITION_INDEX = '00209128';

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
  [STACK_ID, TEMPORAL_POSITION_INDEX].every((tag) => {
    const values = groups
      .map((group) =>
        trimDicomPadding(
          getDatasetTag(sequenceItems(group, FRAME_CONTENT)[0], tag) ?? ''
        )
      )
      .filter(Boolean);
    return new Set(values).size <= 1;
  });

/**
 * Patient-space frames keep their stored pixel order. The third direction
 * follows the positions, which can run opposite the row/column cross product.
 * Ophthalmic scan-line coordinates require a separate calibrated localizer;
 * SliceThickness cannot place frames, so it is only a spacing fallback.
 */
export function multiframeGeometry(metadata: DicomDataset, count: number) {
  const groups = perFrameGroups(metadata);
  const shared = sequenceItems(metadata, SHARED_GROUPS);
  if (count < 2 || (shared.length === 0 && groups.length === 0)) return null;
  // Frames past the per-frame groups read the shared or root tags alike.
  const frames = Array.from(
    { length: Math.min(count, groups.length + 1) },
    (_, index) => readGeometryFacts(metadata, index)
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
        first.orientation !== null &&
        frame.orientation !== null &&
        orientationsAgree(first.orientation, frame.orientation)
    );
  const validated: Reconstruction = readable
    ? reconstruction
    : {
        kind: 'irregular',
        reason: 'unreadable-geometry',
        sliceSpacing: reconstruction.sliceSpacing,
      };
  return { ...first, direction, reconstruction: validated };
}
