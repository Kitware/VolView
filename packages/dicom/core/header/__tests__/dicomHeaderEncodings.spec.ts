import { describe, expect, it } from 'vitest';
import { findElement, readDicomDataset } from '../../metadata/dicomDataset';
import { getDatasetTag } from '../../metadata/datasetAccess';
import { sequenceItems } from '../../metadata/functionalGroups';
import { concatBytes } from '../../utils';
import { readHeader, syntheticSlice } from '@/tests/dicomSourceFixtures';
import {
  rawElement,
  sequenceItem,
  undefinedLengthItem,
  undefinedLengthSequence,
} from '@/tests/specs/syntheticDicom';

const encode = (text: string) => new TextEncoder().encode(text);
const part10 = (syntax: string, dataset: Uint8Array) => {
  const meta = rawElement(2, 0x10, 'UI', encode(`${syntax}\0`));
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, meta.length, true);
  return concatBytes([
    new Uint8Array(128),
    encode('DICM'),
    rawElement(2, 0, 'UL', length),
    meta,
    dataset,
  ]);
};

// The fixture contains only text and SQ values; their bytes are endian-neutral.
const bigEndianElement = (bytes: Uint8Array, longLength = false) => {
  const result = bytes.slice();
  const view = new DataView(result.buffer);
  view.setUint16(0, view.getUint16(0, true));
  view.setUint16(2, view.getUint16(2, true));
  if (longLength) view.setUint32(8, view.getUint32(8, true));
  else view.setUint16(6, view.getUint16(6, true));
  return result;
};

const bigEndianItem = (element: number, length: number) => {
  const bytes = new Uint8Array(8);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, 0xfffe);
  view.setUint16(2, element);
  view.setUint32(4, length);
  return bytes;
};

describe('streamed header encodings', () => {
  it.each([sequenceItem, undefinedLengthItem])(
    'passes encapsulated icon fragments inside %s to the metadata reader',
    async (item) => {
      const payload = new Uint8Array([
        0xff, 0xd8, 0xfe, 0xff, 0xdd, 0xe0, 0, 0, 0, 0, 0xff, 0xd9,
      ]);
      const pixels = undefinedLengthSequence(
        0x7fe0,
        0x0010,
        concatBytes([sequenceItem(new Uint8Array()), sequenceItem(payload)])
      );
      pixels.set(encode('OB'), 4);
      const bytes = syntheticSlice({
        extraElements: [
          undefinedLengthSequence(0x0088, 0x0200, item(pixels)),
          rawElement(0x4008, 0x0103, 'LO', encode('AFTER ')),
        ],
      });
      const { dataset } = await readHeader(bytes, 7);
      const icon = sequenceItems(dataset, '00880200')[0];
      expect(findElement(icon, '7FE00010')?.values).toEqual({
        kind: 'bytes',
        values: [payload],
      });
      expect(getDatasetTag(dataset, '40080103')).toBe('AFTER ');
      expect(dataset).toEqual(readDicomDataset(bytes));
    }
  );

  it('reads undefined-length Big Endian items and their following attributes', async () => {
    const sequence = bigEndianElement(
      rawElement(0x0008, 0x1140, 'SQ', new Uint8Array()),
      true
    );
    new DataView(sequence.buffer).setUint32(8, 0xffffffff);
    const bytes = part10(
      '1.2.840.10008.1.2.2',
      concatBytes([
        sequence,
        bigEndianItem(0xe000, 0xffffffff),
        bigEndianElement(rawElement(8, 0x1155, 'UI', encode('1.2.3\0'))),
        bigEndianItem(0xe00d, 0),
        bigEndianItem(0xe0dd, 0),
        bigEndianElement(rawElement(0x0010, 0x0010, 'PN', encode('DOE^JANE'))),
      ])
    );
    const { dataset } = await readHeader(bytes, 7);
    expect(getDatasetTag(dataset, '00100010')).toBe('DOE^JANE');
    expect(
      getDatasetTag(sequenceItems(dataset, '00081140')[0], '00081155')
    ).toBe('1.2.3');
  });

  it('does not interpret SQ-like compressed bytes as header elements', async () => {
    // A non-final stored DEFLATE block of 0xacfe bytes has 0x53 in byte 4.
    // Its first data byte is 0x51, so a DICOM element walk sees a false SQ VR.
    const elements = concatBytes([
      rawElement(0x0051, 0x0010, 'LO', encode('TEST')),
      rawElement(0x0051, 0x1010, 'OB', new Uint8Array(0xacfe - 38)),
      rawElement(0x4008, 0x0103, 'LO', encode('AFTER ')),
    ]);
    const compressed = concatBytes([
      new Uint8Array([0, 0xfe, 0xac, 0x01, 0x53]),
      elements,
      new Uint8Array([3, 0]),
    ]);
    const bytes = part10('1.2.840.10008.1.2.1.99', compressed);
    expect(getDatasetTag(readDicomDataset(bytes), '40080103')).toBe('AFTER ');
    const { dataset } = await readHeader(bytes, 7);
    expect(getDatasetTag(dataset, '40080103')).toBe('AFTER ');
  });
});
