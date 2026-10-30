import type { DicomDataset } from './dicomDataset';
import { getFrameTag } from './functionalGroups';
import { trimDicomPadding } from '../utils';

/** Describes the spacing actually used by the image, not independent calibration. */
export type AxisSpacing = {
  value: number;
  unit: 'mm' | 'unknown';
  status: 'declared' | 'derived' | 'fallback';
  source: string;
  reason?: string;
};

export type SpatialMetadata = {
  /** Image index axes, in x/y/z order. */
  axes: [AxisSpacing, AxisSpacing, AxisSpacing];
  reconstruction?: { kind: 'regular' | 'irregular'; reason?: string };
  notes: string[];
  calibration?: { type?: string; description?: string };
};

export const physicalSpacing = (
  value: number,
  source: string,
  status: 'declared' | 'derived' = 'declared'
): AxisSpacing => ({ value, unit: 'mm', status, source });

export const fallbackSpacing = (reason: string): AxisSpacing => ({
  value: 1,
  unit: 'unknown',
  status: 'fallback',
  source: 'Display default',
  reason,
});

export function declaredSpacing(raw: string | undefined, source: string) {
  const text = trimDicomPadding(raw ?? '');
  if (!text) return fallbackSpacing(`${source} is not supplied.`);
  const value = Number(text);
  return Number.isFinite(value) && value > 0
    ? physicalSpacing(value, source)
    : fallbackSpacing(`${source} has no usable positive spacing.`);
}

/** Preserve a usable axis even when the other axis is missing or unusable. */
export function readPixelSpacing(metadata: DicomDataset | null | undefined) {
  const raw = trimDicomPadding(getFrameTag(metadata, '00280030') ?? '');
  const parts = raw ? raw.split('\\') : undefined;
  if (parts && parts.length !== 2) {
    return [
      fallbackSpacing('PixelSpacing does not contain two values.'),
      fallbackSpacing('PixelSpacing does not contain two values.'),
    ] as const;
  }
  return [
    declaredSpacing(parts?.[1], 'PixelSpacing'),
    declaredSpacing(parts?.[0], 'PixelSpacing'),
  ] as const;
}
