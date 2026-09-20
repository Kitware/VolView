/** A composed labelmap is written as Uint8, so a label value has to fit in one byte. */
export const LABELMAP_MAX_VALUE = 255;

/**
 * The value every mask marks its own voxels with. A mask holds one segment and
 * nothing else, so the byte says only claimed or not; which segment it belongs
 * to is the mask's identity, not its content. Export assigns its own values at
 * write time, where one file does have to tell segments apart per voxel.
 */
export const SEGMENT_VALUE = 1;

import { LABELMAP_BACKGROUND_VALUE } from '@/src/segmentation/model';

export function nextUnusedLabelValue(
  used: Set<number>,
  maximum: number,
  preferred?: number
) {
  if (
    preferred !== undefined &&
    preferred > LABELMAP_BACKGROUND_VALUE &&
    preferred <= maximum &&
    !used.has(preferred)
  ) {
    return preferred;
  }
  let labelValue = LABELMAP_BACKGROUND_VALUE + 1;
  while (used.has(labelValue)) labelValue += 1;
  if (labelValue > maximum) {
    throw new Error(`An image holds at most ${maximum} segments in a labelmap`);
  }
  return labelValue;
}
