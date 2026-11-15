import type { DicomDataset } from './dicomDataset';
import { getFrameTag, perFrameGroups } from './functionalGroups';
import { numberOr } from '../utils';

export const readModalityRescale = (
  metadata: DicomDataset | null | undefined,
  frameIndex = 0
) => ({
  // GDCM reads a zero slope as 1; matching it keeps native and GDCM pixels equal.
  rescaleSlope: numberOr(getFrameTag(metadata, '00281053', frameIndex), 1) || 1,
  rescaleIntercept: numberOr(getFrameTag(metadata, '00281052', frameIndex), 0),
});

/** Whether every frame shares the first frame's slope and intercept. */
export function hasUniformModalityRescale(metadata: DicomDataset) {
  const first = readModalityRescale(metadata);
  return perFrameGroups(metadata).every((_, index) => {
    const frame = readModalityRescale(metadata, index);
    return (
      frame.rescaleSlope === first.rescaleSlope &&
      frame.rescaleIntercept === first.rescaleIntercept
    );
  });
}
