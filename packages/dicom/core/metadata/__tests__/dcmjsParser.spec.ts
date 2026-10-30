import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { parseDicomElements } from '../dcmjsParser';
import { PART_10_HEADER_LENGTH, PREAMBLE_LENGTH } from '../dicomLayout';
import { concatBytes } from '../../utils';
import { buildSlice } from '@/src/io/__tests__/readDicomTagsFixtures';
import {
  rawElement,
  stripFileMeta,
  stripPreamble,
} from '@/tests/specs/syntheticDicom';

// (0002,0000) UL occupies twelve bytes, including its value.
const GROUP_LENGTH_ELEMENT_LENGTH = 12;
const withoutGroupLength = (file: Uint8Array) =>
  concatBytes([
    file.subarray(0, PART_10_HEADER_LENGTH),
    file.subarray(PART_10_HEADER_LENGTH + GROUP_LENGTH_ELEMENT_LENGTH),
  ]);

// An empty fixed-Huffman block followed by a stored block and a final empty
// block is valid raw DEFLATE. Its first two bytes look like DICOM group 2.
const deflateWithMetaGroupPrefix = (data: Uint8Array) => {
  const header = new Uint8Array([2, 0, 0, 0, 0, 0]);
  const view = new DataView(header.buffer);
  view.setUint16(2, data.length, true);
  view.setUint16(4, 0xffff ^ data.length, true);
  return concatBytes([header, data, new Uint8Array([3, 0])]);
};

describe('file meta information', () => {
  it.each([
    { vr: 'explicit', implicitVr: false, preamble: true },
    { vr: 'implicit', implicitVr: true, preamble: true },
    { vr: 'explicit', implicitVr: false, preamble: false },
    { vr: 'implicit', implicitVr: true, preamble: false },
  ])(
    'reads $vr VR without group length (preamble: $preamble)',
    ({ implicitVr, preamble }) => {
      const file = buildSlice({ implicitVr });
      file.fill(0x41, 0, PREAMBLE_LENGTH);
      const input = withoutGroupLength(file);

      expect(
        parseDicomElements(preamble ? input : stripPreamble(input))
      ).toEqual(parseDicomElements(file));
    }
  );

  it.each([
    { groupLength: true, prefix: 'normal', deflate: deflateRawSync },
    { groupLength: false, prefix: 'normal', deflate: deflateRawSync },
    {
      groupLength: true,
      prefix: 'group 2',
      deflate: deflateWithMetaGroupPrefix,
    },
  ])(
    'reads deflated data after nonzero preamble bytes (group length: $groupLength, prefix: $prefix)',
    ({ groupLength, deflate }) => {
      const file = buildSlice();
      file.fill(0x41, 0, PREAMBLE_LENGTH);
      const encode = (text: string) => new TextEncoder().encode(text);
      const meta = concatBytes([
        rawElement(0x0002, 0x0010, 'UI', encode('1.2.840.10008.1.2.1.99')),
        // The transfer syntax need not be the last file-meta element.
        rawElement(0x0002, 0x0013, 'SH', encode('VOLVIEW ')),
      ]);
      const length = new Uint8Array(4);
      new DataView(length.buffer).setUint32(0, meta.length, true);
      const input = concatBytes([
        file.subarray(0, PART_10_HEADER_LENGTH),
        ...(groupLength ? [rawElement(0x0002, 0x0000, 'UL', length)] : []),
        meta,
        deflate(stripFileMeta(file)),
      ]);

      expect(parseDicomElements(input)).toEqual(parseDicomElements(file));
    }
  );

  it('still rejects file meta information without a transfer syntax', () => {
    const file = buildSlice();
    const input = concatBytes([
      file.subarray(0, PART_10_HEADER_LENGTH),
      rawElement(0x0002, 0x0000, 'UL', new Uint8Array(4)),
      stripFileMeta(file),
    ]);

    expect(() => parseDicomElements(input)).toThrow(
      'the transfer syntax is missing'
    );
  });
});
