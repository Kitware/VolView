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
