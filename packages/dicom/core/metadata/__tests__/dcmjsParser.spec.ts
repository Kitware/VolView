import { readDicomDataset, findElement } from '../dicomDataset';
import { getDatasetTag } from '../datasetAccess';
import { getFrameTag } from '../functionalGroups';
import { DicomMetaLoader } from '../../streaming/dicom/dicomMetaLoader';
import { blobFetcher } from '../../streaming/blobFetcher';
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { parseDicomElements } from '../dcmjsParser';
import { PART_10_HEADER_LENGTH, PREAMBLE_LENGTH } from '../dicomLayout';
import { concatBytes } from '../../utils';
import { buildSlice } from '@/src/io/__tests__/readDicomTagsFixtures';
import {
  rawElement,
  sequenceItem,
  toImplicitVr,
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

describe('lenient headers with standards-defined values', () => {
  const encode = (text: string) => new TextEncoder().encode(text);
  it.each([false, true])(
    'ignores an undersized meta group length (implicit: %s)',
    (implicitVr) => {
      const original = buildSlice({ implicitVr });
      const input = original.slice();
      new DataView(input.buffer).setUint32(PART_10_HEADER_LENGTH + 8, 0, true);
      expect(parseDicomElements(input)).toEqual(parseDicomElements(original));
    }
  );

  it('reads a defined-length SQ containing a redundant sequence delimiter', async () => {
    const value = concatBytes([
      sequenceItem(rawElement(0x0008, 0x1155, 'UI', encode('1.2.3\0'))),
      new Uint8Array([0xfe, 0xff, 0xdd, 0xe0, 0, 0, 0, 0]),
    ]);
    const bytes = buildSlice({
      extraElements: [rawElement(0x0008, 0x1140, 'SQ', value)],
    });
    const loader = new DicomMetaLoader(
      blobFetcher(new Blob([new Uint8Array(bytes)]))
    );
    await loader.load();
    expect(getDatasetTag(loader.meta, '00280010')).toBe('4');
    loader.dispose();
  });

  it('decodes a known defined-length UN using the dataset character set', () => {
    const dataset = readDicomDataset(
      concatBytes([
        rawElement(0x0008, 0x0005, 'CS', encode('ISO_IR 192')),
        rawElement(0x0010, 0x0010, 'UN', encode('M\u00dcLLER ')),
      ])
    );
    expect(getDatasetTag(dataset, '00100010')?.trim()).toBe('M\u00dcLLER');
  });

  it('reads functional groups stored as defined-length UN with implicit items', () => {
    const spacing = rawElement(
      0x0028,
      0x9110,
      'SQ',
      sequenceItem(rawElement(0x0028, 0x0030, 'DS', encode('0.5\\0.75')))
    );
    const dataset = readDicomDataset(
      concatBytes([
        rawElement(0x0008, 0x0060, 'CS', encode('CT')),
        rawElement(0x5200, 0x9229, 'UN', sequenceItem(toImplicitVr(spacing))),
      ])
    );
    expect(getFrameTag(dataset, '00280030')).toBe('0.5\\0.75');
  });

  it('starts undeclared escape runs in the first declared repertoire', () => {
    const dataset = readDicomDataset(
      buildSlice({
        specificCharacterSet: 'ISO 2022 IR 100\\ISO 2022 IR 126',
        patientNameBytes: new Uint8Array([0x52, 0xe9, 0x6d, 0x79]),
      })
    );
    expect(getDatasetTag(dataset, '00100010')).toBe('R\u00e9my');
  });

  it('preserves binary values in sequence items', () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const dataset = readDicomDataset(
      buildSlice({
        extraElements: [
          rawElement(
            0x0008,
            0x1140,
            'SQ',
            sequenceItem(rawElement(0x0029, 0x1010, 'OB', bytes))
          ),
        ],
      })
    );
    const sequence = findElement(dataset, '00081140')!.values;
    if (sequence.kind !== 'sequence') throw new Error('Expected a sequence');
    expect(findElement(sequence.items[0], '00291010')!.values).toEqual({
      kind: 'bytes',
      values: [bytes],
    });
  });

  it.each([false, true])(
    'reads ultrasound calibration from the structured header (implicit: %s)',
    async (implicitVr) => {
      const bytes = buildSlice({
        implicitVr,
        modality: 'US',
        ultrasoundRegion: { physicalDeltaX: 0.05, physicalDeltaY: 0.1 },
      });
      const loader = new DicomMetaLoader(
        blobFetcher(new Blob([new Uint8Array(bytes)]))
      );
      await loader.load();
      expect(loader.ultrasoundRegions).toMatchObject({
        regionCount: 1,
        region: { physicalDeltaX: 0.05, physicalDeltaY: 0.1 },
      });
      loader.dispose();
    }
  );
});

it('decodes a known UN nested inside an explicit sequence with inherited UTF-8', () => {
  const encode = (text: string) => new TextEncoder().encode(text);
  const dataset = readDicomDataset(
    concatBytes([
      rawElement(0x0008, 0x0005, 'CS', encode('ISO_IR 192')),
      rawElement(
        0x0008,
        0x1140,
        'SQ',
        sequenceItem(rawElement(0x0010, 0x0010, 'UN', encode('M\u00dcLLER ')))
      ),
    ])
  );
  const sequence = findElement(dataset, '00081140')!.values;
  if (sequence.kind !== 'sequence') throw new Error('Expected a sequence');
  expect(getDatasetTag(sequence.items[0], '00100010')?.trim()).toBe(
    'M\u00dcLLER'
  );
});

it('stops before a known UN Pixel Data value, even when only its header is present', () => {
  const input = concatBytes([
    rawElement(0x0008, 0x0060, 'CS', new TextEncoder().encode('CT')),
    rawElement(0x7fe0, 0x0010, 'UN', new Uint8Array(16)).subarray(0, 12),
  ]);
  expect(parseDicomElements(input)).toHaveLength(1);
});
