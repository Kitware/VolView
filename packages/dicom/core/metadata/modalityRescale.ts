import type { DicomDataset } from './dicomDataset';
import { getFrameTag, perFrameGroups } from './functionalGroups';
import { trimDicomPadding } from '../utils';

const numberOr = (value: string | undefined, fallback: number) => {
  const text = trimDicomPadding(value ?? '');
  const number = Number(text);
  return text && Number.isFinite(number) ? number : fallback;
};

export const readModalityRescale = (
  metadata: DicomDataset | null | undefined,
  frameIndex = 0
) => ({
  rescaleSlope: numberOr(getFrameTag(metadata, '00281053', frameIndex), 1),
  rescaleIntercept: numberOr(getFrameTag(metadata, '00281052', frameIndex), 0),
});

/** GDCM applies one transform to an instance, so its frames must agree. */
export function assertUniformModalityRescale(metadata: DicomDataset) {
  const first = readModalityRescale(metadata);
  const differs = perFrameGroups(metadata).some((_, index) => {
    const frame = readModalityRescale(metadata, index);
    return (
      frame.rescaleSlope !== first.rescaleSlope ||
      frame.rescaleIntercept !== first.rescaleIntercept
    );
  });
  if (differs)
    throw new Error(
      'Cannot load DICOM frames with differing modality rescale: the decoder applies one transform to the entire instance'
    );
}
