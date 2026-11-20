import type { DicomDataset } from './dicomDataset';
import { getFrameTag } from './functionalGroups';
import { trimDicomPadding } from '../utils';

/** A positive spacing in mm, or the 1 mm display default. */
export function spacingOr1(raw: string | undefined) {
  const value = Number(trimDicomPadding(raw ?? ''));
  return Number.isFinite(value) && value > 0 ? value : 1;
}

/** Column and row spacing; one value means square pixels, and each axis falls back alone. */
export function readPixelSpacing(metadata: DicomDataset | null | undefined) {
  const raw = trimDicomPadding(getFrameTag(metadata, '00280030') ?? '');
  const parts = raw.split('\\');
  if (parts.length < 2) return [spacingOr1(parts[0]), spacingOr1(parts[0])];
  return [spacingOr1(parts[1]), spacingOr1(parts[0])];
}
