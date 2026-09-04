import { LABELMAP_BACKGROUND_VALUE } from '@/src/types/segmentation';

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
