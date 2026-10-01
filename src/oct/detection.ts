import { Tags } from '@/src/core/dicomTags';

export const OPHTHALMIC_TOMOGRAPHY_SOP = '1.2.840.10008.5.1.4.1.1.77.1.5.4';
export const OPHTHALMIC_BSCAN_ANALYSIS_SOP = '1.2.840.10008.5.1.4.1.1.77.1.5.8';
export const OPHTHALMIC_EN_FACE_SOP = '1.2.840.10008.5.1.4.1.1.77.1.5.7';

// Derived metadata, kept separate from DICOM attributes.
export const OCT_SCAN_PATTERN = 'oct:scan-pattern';
export const OCT_GEOMETRY_ERROR = 'oct:geometry-error';

export function isOCTMetadata(metadata: Iterable<[string, string]>) {
  const tags = new Map(metadata);
  const sop = tags.get(Tags.SOPClassUID)?.trim();
  if (sop === OPHTHALMIC_EN_FACE_SOP) return false;
  return (
    sop === OPHTHALMIC_TOMOGRAPHY_SOP ||
    sop === OPHTHALMIC_BSCAN_ANALYSIS_SOP ||
    tags.get(Tags.Modality)?.trim() === 'OPT'
  );
}

export function octGeometryReason(metadata: Iterable<[string, string]>) {
  const tags = new Map(metadata);
  if (tags.get(Tags.OphthalmicVolumetricPropertiesFlag)?.trim() === 'NO') {
    return 'This OCT is marked unsuitable for volumetric processing.';
  }
  const pattern = tags.get(OCT_SCAN_PATTERN);
  if (pattern && !['128279', '128280'].includes(pattern)) {
    return 'En face projection requires a raster or cube OCT volume. This scan pattern needs spatial reconstruction.';
  }
  return tags.get(OCT_GEOMETRY_ERROR) ?? null;
}

export function octCalibratedAxes(metadata: Iterable<[string, string]>) {
  const tags = new Map(metadata);
  const spacing = tags.get(Tags.PixelSpacing)?.split('\\').map(Number) ?? [];
  const usable = (n: number | undefined) =>
    n !== undefined && Number.isFinite(n) && n > 0;
  return [
    usable(spacing[1]),
    usable(spacing[0]),
    usable(Number(tags.get(Tags.SpacingBetweenSlices))),
  ];
}
