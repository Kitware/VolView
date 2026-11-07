import { getDatasetTag } from '../../metadata/datasetAccess';
import { sequenceItems } from '../../metadata/functionalGroups';
import type { DicomDataset } from '../../metadata/dicomDataset';
import { trimDicomPadding } from '../../utils';
import { Tags } from '../../metadata/dicomTags';

// DICOM unit codes for PhysicalUnitsXDirection / YDirection.
// See DICOM PS3.3 C.8.5.5.1.15. The only spatial spacing code defined for
// this field is 3 (cm). Other codes (0=none, 1=percent, 2=dB, 4=seconds,
// 5=hertz, 6=dB/sec, 7=cm/sec, 8=cm², 9=cm²/sec, 10=cm³, 11=cm³/sec,
// 12=degrees) are time, frequency, velocity, area, volume, or angle, so
// they are not converted to a VTK image spacing.
export const US_UNIT_CENTIMETERS = 3;

// Returns the multiplier that converts a physical-delta value in the given
// unit to millimetres, or null when the unit is not a spatial spacing.
export const unitToMm = (code: number): number | null => {
  if (code === US_UNIT_CENTIMETERS) return 10;
  return null;
};

export type UltrasoundRegion = {
  physicalDeltaX: number;
  physicalDeltaY: number;
  physicalUnitsXDirection: number;
  physicalUnitsYDirection: number;
};

// First-region spacing plus the total number of regions in the source
// SequenceOfUltrasoundRegions. Multi-region images (e.g. dual-pane B-mode +
// Doppler) cannot be fully represented with a single VTK image spacing, so
// we expose the count to let callers warn about partial support.
export type UltrasoundRegions = {
  region?: UltrasoundRegion;
  regionCount: number;
};

/** The structured header supplies regions in either transfer syntax. */
export function readUltrasoundRegions(
  metadata: DicomDataset
): UltrasoundRegions {
  const items = sequenceItems(
    metadata,
    Tags.SequenceOfUltrasoundRegions.replace('|', '')
  );
  const value = (tag: string) => {
    const text = trimDicomPadding(getDatasetTag(items[0], tag) ?? '');
    return text ? Number(text) : NaN;
  };
  const region = {
    physicalDeltaX: value(Tags.PhysicalDeltaX),
    physicalDeltaY: value(Tags.PhysicalDeltaY),
    physicalUnitsXDirection: value(Tags.PhysicalUnitsXDirection),
    physicalUnitsYDirection: value(Tags.PhysicalUnitsYDirection),
  };
  return {
    regionCount: items.length,
    ...(Object.values(region).every(Number.isFinite) ? { region } : {}),
  };
}
