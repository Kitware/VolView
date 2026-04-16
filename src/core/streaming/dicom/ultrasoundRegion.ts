import {
  createDicomParser,
  DataElement,
} from '@/src/core/streaming/dicom/dicomParser';
import { Tags, tagToGroupElement } from '@/src/core/dicomTags';

export const US_REGION_META_KEY = '__volview_us_region';

// DICOM unit codes for PhysicalUnitsXDirection / YDirection
// 0x0003 = centimeters. See DICOM PS3.3 C.8.5.5.1.1.
export const US_UNIT_CENTIMETERS = 3;

export type UltrasoundRegion = {
  physicalDeltaX: number;
  physicalDeltaY: number;
  physicalUnitsXDirection: number;
  physicalUnitsYDirection: number;
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
 * Decodes the first item of a SequenceOfUltrasoundRegions element.
 * Returns null if required fields are missing.
 */
export function decodeUltrasoundRegion(
  sequenceData: DataElement['data']
): UltrasoundRegion | null {
  if (!Array.isArray(sequenceData) || sequenceData.length === 0) return null;
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

  if (!deltaXBytes || !deltaYBytes || !unitsXBytes || !unitsYBytes) {
    return null;
  }

  return {
    physicalDeltaX: readFloat64LE(deltaXBytes),
    physicalDeltaY: readFloat64LE(deltaYBytes),
    physicalUnitsXDirection: readUint16LE(unitsXBytes),
    physicalUnitsYDirection: readUint16LE(unitsYBytes),
  };
}

/**
 * Parses a DICOM blob and returns the first ultrasound region, if present.
 */
export async function parseUltrasoundRegionFromBlob(
  blob: Blob
): Promise<UltrasoundRegion | null> {
  let region: UltrasoundRegion | null = null;

  const parse = createDicomParser({
    stopAtElement(group, element) {
      return group === 0x7fe0 && element === 0x0010;
    },
    onDataElement(el) {
      if (region) return;
      if (isTag(el, SEQUENCE_OF_ULTRASOUND_REGIONS)) {
        region = decodeUltrasoundRegion(el.data);
      }
    },
  });

  const stream = blob.stream();
  const reader = stream.getReader();
  try {
    while (!region) {
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

  return region;
}

export function encodeUltrasoundRegionMeta(
  region: UltrasoundRegion
): [string, string] {
  return [US_REGION_META_KEY, JSON.stringify(region)];
}

export function getUltrasoundRegionFromMetadata(
  meta: ReadonlyArray<readonly [string, string]> | null | undefined
): UltrasoundRegion | null {
  if (!meta) return null;
  const entry = meta.find(([key]) => key === US_REGION_META_KEY);
  if (!entry) return null;
  try {
    return JSON.parse(entry[1]) as UltrasoundRegion;
  } catch {
    return null;
  }
}
