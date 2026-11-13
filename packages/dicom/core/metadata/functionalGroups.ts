import type { DicomDataset } from './dicomDataset';
import { findElement } from './dicomDataset';
import { getDatasetTag } from './datasetAccess';
import { getNmDetectorTag } from './nmReconstruction';

const SHARED_GROUPS = '52009229';
const PER_FRAME_GROUPS = '52009230';

const IMAGE_MACROS = new Map([
  ['00180050', '00289110'], // Pixel Measures: Slice Thickness
  ['00180088', '00289110'], // Pixel Measures: Spacing Between Slices
  ['00280030', '00289110'], // Pixel Measures: Pixel Spacing
  ['00200032', '00209113'], // Plane Position (Patient)
  ['00200037', '00209116'], // Plane Orientation (Patient)
  ['00281052', '00289145'], // Pixel Value Transformation: Intercept
  ['00281053', '00289145'], // Pixel Value Transformation: Slope
]);

export function sequenceItems(dataset: DicomDataset, tag: string) {
  const values = findElement(dataset, tag)?.values;
  return values?.kind === 'sequence' ? values.items : [];
}

const macroValue = (
  group: DicomDataset | undefined,
  macro: string,
  tag: string
) => (group ? getDatasetTag(sequenceItems(group, macro)[0], tag) : undefined);

/**
 * Image attributes have specific Functional Group paths. Unrelated nested
 * sequences, including referenced images, never supply the image's own tags.
 */
export function getFrameTag(
  dataset: DicomDataset | null | undefined,
  tag: string,
  frameIndex = 0
) {
  if (!dataset) return undefined;
  const key = tag.replace('|', '').toUpperCase();
  const macro = IMAGE_MACROS.get(key);
  if (!macro) return getDatasetTag(dataset, key);
  const perFrame = sequenceItems(dataset, PER_FRAME_GROUPS)[frameIndex];
  const shared = sequenceItems(dataset, SHARED_GROUPS)[0];
  return (
    macroValue(perFrame, macro, key) ??
    macroValue(shared, macro, key) ??
    getNmDetectorTag(dataset, key) ??
    getDatasetTag(dataset, key)
  );
}

export const perFrameGroups = (dataset: DicomDataset) =>
  sequenceItems(dataset, PER_FRAME_GROUPS);
