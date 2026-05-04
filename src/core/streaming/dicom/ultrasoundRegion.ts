import {
  createDicomParser,
  DataElement,
} from '@/src/core/streaming/dicom/dicomParser';
import { Tags, tagToGroupElement } from '@/src/core/dicomTags';

export const US_REGION_META_KEY = '__volview_us_region';

// DICOM unit codes for PhysicalUnitsXDirection / YDirection.
// See DICOM PS3.3 C.8.5.5.1.15. The only spatial spacing code defined for
// this field is 3 (cm). Other codes (0=none, 1=percent, 2=dB, 4=seconds,
// 5=hertz, 6=dB/seconds, 7=cm/sec, 8=cm², 9=cm²/sec, A=degrees) are time,
// frequency, velocity, area, or angle, so they are not converted to a VTK
// image spacing.
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
  region: UltrasoundRegion | null;
  regionCount: number;
};

export const SEQUENCE_OF_ULTRASOUND_REGIONS = tagToGroupElement(
  Tags.SequenceOfUltrasoundRegions
);
const PHYSICAL_DELTA_X = tagToGroupElement(Tags.PhysicalDeltaX);
const PHYSICAL_DELTA_Y = tagToGroupElement(Tags.PhysicalDeltaY);
const PHYSICAL_UNITS_X_DIRECTION = tagToGroupElement(
  Tags.PhysicalUnitsXDirection
);
const PHYSICAL_UNITS_Y_DIRECTION = tagToGroupElement(
  Tags.PhysicalUnitsYDirection
);

const isTag = (el: DataElement, [group, element]: [number, number]) =>
  el.group === group && el.element === element;

const readFloat64LE = (bytes: Uint8Array) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getFloat64(
    0,
    true
  );

const readUint16LE = (bytes: Uint8Array) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(
    0,
    true
  );

/**
 * Decodes the first item of a SequenceOfUltrasoundRegions element and
 * reports the total number of regions found. The first region's spacing
 * is what gets applied to the VTK image; the count lets callers warn when
 * additional regions exist (multi-region images are only partially
 * supported because VTK image data has a single global spacing).
 */
export function decodeUltrasoundRegion(
  sequenceData: DataElement['data']
): UltrasoundRegions {
  if (!Array.isArray(sequenceData) || sequenceData.length === 0) {
    return { region: null, regionCount: 0 };
  }
  const [firstItem] = sequenceData;

  const findBytes = (target: [number, number]) => {
    const el = firstItem.find((inner) => isTag(inner, target));
    if (!el || !(el.data instanceof Uint8Array)) return null;
    return el.data;
  };

  const deltaXBytes = findBytes(PHYSICAL_DELTA_X);
  const deltaYBytes = findBytes(PHYSICAL_DELTA_Y);
  const unitsXBytes = findBytes(PHYSICAL_UNITS_X_DIRECTION);
  const unitsYBytes = findBytes(PHYSICAL_UNITS_Y_DIRECTION);

  const regionCount = sequenceData.length;
  if (!deltaXBytes || !deltaYBytes || !unitsXBytes || !unitsYBytes) {
    return { region: null, regionCount };
  }

  return {
    region: {
      physicalDeltaX: readFloat64LE(deltaXBytes),
      physicalDeltaY: readFloat64LE(deltaYBytes),
      physicalUnitsXDirection: readUint16LE(unitsXBytes),
      physicalUnitsYDirection: readUint16LE(unitsYBytes),
    },
    regionCount,
  };
}

/**
 * Parses a DICOM blob and returns the first ultrasound region plus the
 * total region count, if a SequenceOfUltrasoundRegions is present.
 */
export async function parseUltrasoundRegionFromBlob(
  blob: Blob
): Promise<UltrasoundRegions | null> {
  let regions: UltrasoundRegions | null = null;

  const parse = createDicomParser({
    stopAtElement(group, element) {
      return group === 0x7fe0 && element === 0x0010;
    },
    onDataElement(el) {
      if (regions) return;
      if (isTag(el, SEQUENCE_OF_ULTRASOUND_REGIONS)) {
        regions = decodeUltrasoundRegion(el.data);
      }
    },
  });

  const stream = blob.stream();
  const reader = stream.getReader();
  try {
    while (!regions) {
      const { value, done } = await reader.read();
      if (done) break;
      const result = parse(value);
      if (result.done) break;
    }
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }

  return regions;
}

export function encodeUltrasoundRegionMeta(
  regions: UltrasoundRegions
): [string, string] {
  return [US_REGION_META_KEY, JSON.stringify(regions)];
}

export function getUltrasoundRegionFromMetadata(
  meta: ReadonlyArray<readonly [string, string]> | null | undefined
): UltrasoundRegions | null {
  if (!meta) return null;
  const entry = meta.find(([key]) => key === US_REGION_META_KEY);
  if (!entry) return null;
  try {
    return JSON.parse(entry[1]) as UltrasoundRegions;
  } catch {
    return null;
  }
}
