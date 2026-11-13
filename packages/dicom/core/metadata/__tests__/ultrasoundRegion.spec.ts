import { describe, it, expect } from 'vitest';
import { readDicomDataset } from '../dicomDataset';
import { concatBytes } from '../../utils';
import { syntheticSlice } from '@/tests/dicomSourceFixtures';
import { rawElement, sequenceItem } from '@/tests/specs/syntheticDicom';
import {
  readUltrasoundRegions,
  unitToMm,
  US_UNIT_CENTIMETERS,
} from '../ultrasoundRegion';

const u16LE = (value: number) => {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, true);
  return bytes;
};

const f64LE = (value: number) => {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setFloat64(0, value, true);
  return bytes;
};

const wellFormedItem = [
  rawElement(0x0018, 0x6024, 'US', u16LE(US_UNIT_CENTIMETERS)),
  rawElement(0x0018, 0x6026, 'US', u16LE(US_UNIT_CENTIMETERS)),
  rawElement(0x0018, 0x602c, 'FD', f64LE(0.05)),
  rawElement(0x0018, 0x602e, 'FD', f64LE(0.1)),
];

const regions = (items: Uint8Array[][]) =>
  readUltrasoundRegions(
    readDicomDataset(
      syntheticSlice({
        extraElements: [
          rawElement(
            0x0018,
            0x6011,
            'SQ',
            concatBytes(items.map((item) => sequenceItem(concatBytes(item))))
          ),
        ],
      })
    )
  );

describe('readUltrasoundRegions', () => {
  it('decodes the first item of the sequence', () => {
    expect(regions([wellFormedItem])).toEqual({
      region: {
        physicalDeltaX: 0.05,
        physicalDeltaY: 0.1,
        physicalUnitsXDirection: US_UNIT_CENTIMETERS,
        physicalUnitsYDirection: US_UNIT_CENTIMETERS,
      },
      regionCount: 1,
    });
  });

  it('returns no region when the sequence is empty or absent', () => {
    expect(regions([])).toEqual({ regionCount: 0 });
    expect(readUltrasoundRegions(readDicomDataset(syntheticSlice()))).toEqual({
      regionCount: 0,
    });
  });

  it('reports the count when a required field is missing', () => {
    expect(regions([wellFormedItem.slice(0, -1)])).toEqual({ regionCount: 1 });
  });

  it('decodes only the first item but reports the total count', () => {
    expect(regions([wellFormedItem, []])).toEqual({
      ...regions([wellFormedItem]),
      regionCount: 2,
    });
  });
});

describe('unitToMm', () => {
  it('returns 10 for centimetres (code 3)', () => {
    expect(unitToMm(US_UNIT_CENTIMETERS)).toBe(10);
  });

  it('returns null for non-spatial unit codes', () => {
    [0, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12].forEach((code) => {
      expect(unitToMm(code)).toBeNull();
    });
  });
});
