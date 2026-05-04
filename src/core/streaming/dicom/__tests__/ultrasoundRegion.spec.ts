import { describe, it, expect } from 'vitest';
import type { DataElement } from '@/src/core/streaming/dicom/dicomParser';
import {
  decodeUltrasoundRegion,
  parseUltrasoundRegionFromBlob,
  unitToMm,
  US_UNIT_CENTIMETERS,
} from '@/src/core/streaming/dicom/ultrasoundRegion';

const u16LE = (v: number) => {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, v, true);
  return b;
};

const f64LE = (v: number) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setFloat64(0, v, true);
  return b;
};

const concat = (parts: Uint8Array[]) => {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  parts.forEach((p) => {
    out.set(p, offset);
    offset += p.length;
  });
  return out;
};

// Builds an explicit-VR-LE data element for a VR with 2-byte length (US/FD/UI/etc).
const shortVRElement = (
  group: number,
  element: number,
  vr: string,
  value: Uint8Array
) => {
  const header = new Uint8Array(8);
  const dv = new DataView(header.buffer);
  dv.setUint16(0, group, true);
  dv.setUint16(2, element, true);
  header[4] = vr.charCodeAt(0);
  header[5] = vr.charCodeAt(1);
  dv.setUint16(6, value.length, true);
  return concat([header, value]);
};

type Item = { group: number; element: number; vr: string; value: Uint8Array };

// Fake parsed sequence data mirroring what readSequenceValue emits.
const fakeSequenceData = (items: Item[][]): DataElement['data'] =>
  items.map(
    (elements) =>
      elements.map((e) => ({
        group: e.group,
        element: e.element,
        vr: e.vr,
        length: e.value.length,
        data: e.value,
      })) as DataElement[]
  );

const wellFormedItem: Item[] = [
  {
    group: 0x0018,
    element: 0x6024,
    vr: 'US',
    value: u16LE(US_UNIT_CENTIMETERS),
  },
  {
    group: 0x0018,
    element: 0x6026,
    vr: 'US',
    value: u16LE(US_UNIT_CENTIMETERS),
  },
  { group: 0x0018, element: 0x602c, vr: 'FD', value: f64LE(0.05) },
  { group: 0x0018, element: 0x602e, vr: 'FD', value: f64LE(0.1) },
];

describe('decodeUltrasoundRegion', () => {
  it('decodes the first item of the sequence', () => {
    const result = decodeUltrasoundRegion(fakeSequenceData([wellFormedItem]));
    expect(result).toEqual({
      region: {
        physicalDeltaX: 0.05,
        physicalDeltaY: 0.1,
        physicalUnitsXDirection: US_UNIT_CENTIMETERS,
        physicalUnitsYDirection: US_UNIT_CENTIMETERS,
      },
      regionCount: 1,
    });
  });

  it('returns a null region with zero count when the sequence is empty', () => {
    expect(decodeUltrasoundRegion([])).toEqual({
      region: null,
      regionCount: 0,
    });
  });

  it('returns a null region with zero count when the data is not a sequence', () => {
    expect(decodeUltrasoundRegion(undefined)).toEqual({
      region: null,
      regionCount: 0,
    });
    expect(decodeUltrasoundRegion(new Uint8Array(4))).toEqual({
      region: null,
      regionCount: 0,
    });
  });

  it('returns a null region but reports the count when a required field is missing', () => {
    const missingDeltaY = wellFormedItem.filter(
      (e) => !(e.group === 0x0018 && e.element === 0x602e)
    );
    expect(decodeUltrasoundRegion(fakeSequenceData([missingDeltaY]))).toEqual({
      region: null,
      regionCount: 1,
    });
  });

  it('decodes only the first item but reports the total count', () => {
    const second: Item[] = [
      { group: 0x0018, element: 0x6024, vr: 'US', value: u16LE(0) },
      { group: 0x0018, element: 0x6026, vr: 'US', value: u16LE(0) },
      { group: 0x0018, element: 0x602c, vr: 'FD', value: f64LE(999) },
      { group: 0x0018, element: 0x602e, vr: 'FD', value: f64LE(999) },
    ];
    const result = decodeUltrasoundRegion(
      fakeSequenceData([wellFormedItem, second])
    );
    expect(result.region?.physicalDeltaX).toBe(0.05);
    expect(result.regionCount).toBe(2);
  });
});

describe('unitToMm', () => {
  it('returns 10 for centimetres (code 3)', () => {
    expect(unitToMm(US_UNIT_CENTIMETERS)).toBe(10);
  });

  it('returns null for non-spatial unit codes', () => {
    // Per DICOM PS3.3 C.8.5.5.1.15: 0=none, 1=percent, 2=dB, 4=seconds,
    // 5=hertz, 6=dB/sec, 7=cm/sec, 8=cm², 9=cm²/sec, 10=degrees.
    [0, 1, 2, 4, 5, 6, 7, 8, 9, 10].forEach((code) => {
      expect(unitToMm(code)).toBeNull();
    });
  });
});

// Builds a minimal DICOM P10 byte stream containing only what the ultrasound
// parser needs: preamble, DICM magic, a TransferSyntaxUID (Explicit VR LE),
// and a SequenceOfUltrasoundRegions with one populated item.
const buildDicomBlob = (item: Item[]) => {
  const preamble = new Uint8Array(128);
  const magic = new TextEncoder().encode('DICM');

  // File Meta Info: just TransferSyntaxUID. The parser exits the meta block
  // as soon as it peeks a non-0x0002 group, so FileMetaInformationGroupLength
  // is not required here.
  const tsxValue = new TextEncoder().encode('1.2.840.10008.1.2.1\0');
  const tsx = shortVRElement(0x0002, 0x0010, 'UI', tsxValue);

  const itemBody = concat(
    item.map((e) => shortVRElement(e.group, e.element, e.vr, e.value))
  );

  // Item header: (fffe,e000) tag + 4-byte length.
  const itemHeader = new Uint8Array(8);
  const ivh = new DataView(itemHeader.buffer);
  ivh.setUint16(0, 0xfffe, true);
  ivh.setUint16(2, 0xe000, true);
  ivh.setUint32(4, itemBody.length, true);

  const sequenceBody = concat([itemHeader, itemBody]);

  // SQ header: tag + "SQ" + 2 reserved + 4-byte length.
  const sqHeader = new Uint8Array(12);
  const sqh = new DataView(sqHeader.buffer);
  sqh.setUint16(0, 0x0018, true);
  sqh.setUint16(2, 0x6011, true);
  sqHeader[4] = 'S'.charCodeAt(0);
  sqHeader[5] = 'Q'.charCodeAt(0);
  sqh.setUint32(8, sequenceBody.length, true);

  // Pixel data tag so the parser reaches its stop condition cleanly.
  const pixelDataTag = new Uint8Array(4);
  new DataView(pixelDataTag.buffer).setUint16(0, 0x7fe0, true);
  new DataView(pixelDataTag.buffer).setUint16(2, 0x0010, true);

  return new Blob([
    concat([preamble, magic, tsx, sqHeader, sequenceBody, pixelDataTag]),
  ]);
};

describe('parseUltrasoundRegionFromBlob', () => {
  it('extracts the region and count from a synthetic DICOM blob', async () => {
    const blob = buildDicomBlob(wellFormedItem);
    const result = await parseUltrasoundRegionFromBlob(blob);
    expect(result).toEqual({
      region: {
        physicalDeltaX: 0.05,
        physicalDeltaY: 0.1,
        physicalUnitsXDirection: US_UNIT_CENTIMETERS,
        physicalUnitsYDirection: US_UNIT_CENTIMETERS,
      },
      regionCount: 1,
    });
  });

  it('returns null when the blob has no SequenceOfUltrasoundRegions', async () => {
    // Build a blob with only the TransferSyntaxUID + pixel data tag.
    const preamble = new Uint8Array(128);
    const magic = new TextEncoder().encode('DICM');
    const tsxValue = new TextEncoder().encode('1.2.840.10008.1.2.1\0');
    const tsx = shortVRElement(0x0002, 0x0010, 'UI', tsxValue);
    const pixelDataTag = new Uint8Array(4);
    new DataView(pixelDataTag.buffer).setUint16(0, 0x7fe0, true);
    new DataView(pixelDataTag.buffer).setUint16(2, 0x0010, true);
    const blob = new Blob([concat([preamble, magic, tsx, pixelDataTag])]);

    expect(await parseUltrasoundRegionFromBlob(blob)).toBeNull();
  });
});
