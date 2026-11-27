import type { DicomDataset } from './dicomDataset';
import { getDatasetTag } from './datasetAccess';
import { getFrameTag } from './functionalGroups';
import { numberOr, trimDicomPadding } from '../utils';

// The SOP classes whose Pixel Value Transformation functional group is
// applied, as GDCM applies it. The others' IODs keep the modality rescale at
// the top level.
const FUNCTIONAL_GROUP_RESCALE = new Set([
  '1.2.840.10008.5.1.4.1.1.2.1', // Enhanced CT
  '1.2.840.10008.5.1.4.1.1.2.2', // Legacy Converted Enhanced CT
  '1.2.840.10008.5.1.4.1.1.4.1', // Enhanced MR
  '1.2.840.10008.5.1.4.1.1.4.4', // Legacy Converted Enhanced MR
  '1.2.840.10008.5.1.4.1.1.130', // Enhanced PET
  '1.2.840.10008.5.1.4.1.1.128.1', // Legacy Converted Enhanced PET
  '1.2.840.10008.5.1.4.1.1.13.1.1', // X-Ray 3D Angiographic
  '1.2.840.10008.5.1.4.1.1.13.1.2', // X-Ray 3D Craniofacial
  '1.2.840.10008.5.1.4.1.1.13.1.3', // Breast Tomosynthesis
  '1.2.840.10008.5.1.4.1.1.13.1.4', // Breast Projection X-Ray For Presentation
  '1.2.840.10008.5.1.4.1.1.13.1.5', // Breast Projection X-Ray For Processing
  '1.2.840.10008.5.1.4.1.1.66.4', // Segmentation
]);

const rescaleTag = (
  metadata: DicomDataset | null | undefined,
  tag: string,
  frameIndex: number
) =>
  FUNCTIONAL_GROUP_RESCALE.has(
    trimDicomPadding(getDatasetTag(metadata, '00080016') ?? '')
  )
    ? getFrameTag(metadata, tag, frameIndex)
    : getDatasetTag(metadata, tag);

export const readModalityRescale = (
  metadata: DicomDataset | null | undefined,
  frameIndex = 0
) => ({
  // A zero slope reads as 1, as GDCM reads it.
  rescaleSlope: numberOr(rescaleTag(metadata, '00281053', frameIndex), 1) || 1,
  rescaleIntercept: numberOr(rescaleTag(metadata, '00281052', frameIndex), 0),
});
