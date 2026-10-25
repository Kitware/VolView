import { describe, expect, it } from 'vitest';
import {
  DicomDataset,
  findElement,
  readDicomDataset,
} from '@/src/io/dicomDataset';
import {
  rawElement,
  sequenceItem,
  undefinedLengthItem,
  undefinedLengthSequence,
} from '@/tests/specs/syntheticDicom';
import {
  buildSlice,
  JAPANESE_NAME,
  JAPANESE_NAME_BYTES,
  MIXED_VR_ELEMENTS,
  UTF8_NAME,
  UTF8_NAME_BYTES,
} from './readDicomTagsFixtures';

const PATIENT_NAME = '00100010';
const PIXEL_SPACING = '00280030';
const IMAGE_POSITION_PATIENT = '00200032';
const SPECIFIC_CHARACTER_SET = '00080005';
const ICC_PROFILE = '00282000';
const FRAME_DIMENSION_POINTER = '0028000A';
const SIEMENS_CSA_DATA = '00291010';
const GE_PRIVATE_TAG = '00091001';
const ULTRASOUND_REGIONS = '00186011';
const PHYSICAL_DELTA_X = '0018602C';
const REQUEST_ATTRIBUTES = '00400275';
const REFERENCED_STUDY = '00400008';
const CODE_MEANING = '00080104';
const SCHEDULED_PROCEDURE_STEP_ID = '00400009';
const CURRENT_PATIENT_LOCATION = '00380300';
const PERFORMING_PHYSICIAN_NAME = '00081050';
const STUDY_COMMENTS = '00324000';

const ascii = (text: string) => new TextEncoder().encode(text);

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  parts.reduce((offset, part) => {
    out.set(part, offset);
    return offset + part.length;
  }, 0);
  return out;
};

const item = sequenceItem;

const sequence = (group: number, element: number, items: Uint8Array) =>
  rawElement(group, element, 'SQ', items);

// (0040,0275) holding one item that itself holds a sequence, which is the
// shape an enhanced object's functional groups take.
const NESTED_SEQUENCE = sequence(
  0x0040,
  0x0275,
  item(
    concat(
      sequence(
        0x0040,
        0x0008,
        item(rawElement(0x0008, 0x0104, 'LO', ascii('MEANING ')))
      ),
      rawElement(0x0040, 0x0009, 'SH', ascii('SPS1    '))
    )
  )
);

// A Japanese data set names the default repertoire and the extension its
// ideographic runs escape into, which is the shape real studies write.
const JAPANESE_CHARACTER_SET = 'ISO 2022 IR 6\\ISO 2022 IR 87';

// A code meaning whose UTF-8 bytes no single byte character set survives.
const UTF8_ITEM_TEXT = '\u738b ';

const valuesOf = (dataset: DicomDataset, tag: string) =>
  findElement(dataset, tag)?.values;

describe('readDicomDataset', () => {
  it('keeps the tag, VR and value multiplicity of every element', () => {
    const dataset = readDicomDataset(
      buildSlice({ pixelSpacing: [0.5, 0.75], imagePositionPatient: [0, 0, 0] })
    );

    expect(findElement(dataset, PIXEL_SPACING)).toMatchObject({
      tag: PIXEL_SPACING,
      group: 0x0028,
      element: 0x0030,
      vr: 'DS',
    });
    expect(valuesOf(dataset, PIXEL_SPACING)).toEqual({
      kind: 'decimal',
      values: [0.5, 0.75],
      text: ['0.5', '0.75'],
    });
    expect(valuesOf(dataset, IMAGE_POSITION_PATIENT)).toEqual({
      kind: 'decimal',
      values: [0, 0, 0],
      text: ['0', '0', '0 '],
    });
  });

  it('reads a DS value that is not a number as null, not as zero', () => {
    const dataset = readDicomDataset(
      buildSlice({
        extraElements: [rawElement(0x0040, 0x9224, 'DS', ascii('1\\\\3'))],
      })
    );

    expect(valuesOf(dataset, '00409224')).toEqual({
      kind: 'decimal',
      values: [1, null, 3],
      text: ['1', '', '3'],
    });
  });

  it('descends into a sequence and into the sequence inside it', () => {
    const dataset = readDicomDataset(
      buildSlice({ extraElements: [NESTED_SEQUENCE] })
    );
    const outer = valuesOf(dataset, REQUEST_ATTRIBUTES);
    if (outer?.kind !== 'sequence') throw new Error('not a sequence');
    const inner = valuesOf(outer.items[0], REFERENCED_STUDY);
    if (inner?.kind !== 'sequence') throw new Error('not a sequence');

    expect(outer.items).toHaveLength(1);
    expect(valuesOf(outer.items[0], SCHEDULED_PROCEDURE_STEP_ID)).toEqual({
      kind: 'text',
      values: ['SPS1    '],
    });
    expect(inner.items).toHaveLength(1);
    expect(valuesOf(inner.items[0], CODE_MEANING)).toEqual({
      kind: 'text',
      values: ['MEANING '],
    });
  });

  it.each([
    ['inherits the enclosing', []],
    [
      'declares its own',
      [rawElement(0x0008, 0x0005, 'CS', ascii('ISO_IR 192'))],
    ],
  ])('decodes an item that %s character set once', (_, localCharacterSet) => {
    const dataset = readDicomDataset(
      buildSlice({
        specificCharacterSet: 'ISO_IR 192',
        extraElements: [
          sequence(
            0x0040,
            0x0275,
            item(
              concat(
                ...localCharacterSet,
                rawElement(0x0008, 0x0104, 'LO', ascii(UTF8_ITEM_TEXT))
              )
            )
          ),
        ],
      })
    );
    const values = valuesOf(dataset, REQUEST_ATTRIBUTES);
    if (values?.kind !== 'sequence') throw new Error('not a sequence');

    expect(valuesOf(values.items[0], CODE_MEANING)).toEqual({
      kind: 'text',
      values: [UTF8_ITEM_TEXT],
    });
  });

  it.each([
    [
      'a defined length',
      (content: Uint8Array) => sequence(0x0040, 0x0275, item(content)),
    ],
    [
      'an undefined length',
      (content: Uint8Array) =>
        undefinedLengthSequence(0x0040, 0x0275, undefinedLengthItem(content)),
    ],
  ])(
    'decodes an item of %s sequence that declares a character set extension',
    (_, build) => {
      const dataset = readDicomDataset(
        buildSlice({
          specificCharacterSet: JAPANESE_CHARACTER_SET,
          extraElements: [
            build(
              concat(
                rawElement(0x0008, 0x0005, 'CS', ascii(JAPANESE_CHARACTER_SET)),
                rawElement(0x0010, 0x0010, 'PN', JAPANESE_NAME_BYTES)
              )
            ),
          ],
        })
      );
      const values = valuesOf(dataset, REQUEST_ATTRIBUTES);
      if (values?.kind !== 'sequence') throw new Error('not a sequence');

      expect(values.items[0].specificCharacterSet).toEqual([
        'ISO 2022 IR 6',
        'ISO 2022 IR 87',
      ]);
      expect(valuesOf(values.items[0], PATIENT_NAME)).toEqual({
        kind: 'text',
        values: [JAPANESE_NAME],
      });
    }
  );

  it.each([
    ['explicit', false],
    ['implicit', true],
  ])(
    'reads the elements of an %s VR ultrasound region item',
    (_, implicitVr) => {
      const dataset = readDicomDataset(
        buildSlice({
          implicitVr,
          ultrasoundRegion: { physicalDeltaX: 0.1, physicalDeltaY: 0.2 },
        })
      );
      const values = valuesOf(dataset, ULTRASOUND_REGIONS);
      if (values?.kind !== 'sequence') throw new Error('not a sequence');

      expect(values.items[0].elements.map(({ tag }) => tag)).toEqual([
        '00186024',
        '00186026',
        '0018602C',
        '0018602E',
      ]);
      expect(valuesOf(values.items[0], PHYSICAL_DELTA_X)).toEqual({
        kind: 'number',
        values: [0.1],
      });
    }
  );

  it('keeps the bytes of a sequence whose items it cannot read', () => {
    // An item that claims more bytes than the sequence holds.
    const truncatedItem = new Uint8Array([
      0xfe, 0xff, 0x00, 0xe0, 0x40, 0x00, 0x00, 0x00, 0x18, 0x00, 0x24, 0x60,
    ]);
    const dataset = readDicomDataset(
      buildSlice({
        extraElements: [rawElement(0x0018, 0x6011, 'SQ', truncatedItem)],
      })
    );
    const values = valuesOf(dataset, ULTRASOUND_REGIONS);
    if (values?.kind !== 'unread') throw new Error('unexpectedly read');

    expect(values.bytes).toEqual(truncatedItem);
    expect(values.reason.length).toBeGreaterThan(0);
  });

  it('keeps a private element and the bytes of its value', () => {
    const dataset = readDicomDataset(
      buildSlice({ extraElements: MIXED_VR_ELEMENTS })
    );

    expect(findElement(dataset, SIEMENS_CSA_DATA)?.bytes).toEqual(
      new Uint8Array(6).fill(0x41)
    );
    expect(findElement(dataset, GE_PRIVATE_TAG)?.bytes).toEqual(
      ascii('GEPRIV  ')
    );
    expect(findElement(dataset, GE_PRIVATE_TAG)?.vr).toBe('SH');
  });

  it('leaves a public element of a known VR without a byte copy', () => {
    const dataset = readDicomDataset(buildSlice());

    expect(findElement(dataset, PATIENT_NAME)?.bytes).toBeUndefined();
  });

  it('reads a buffer VR as bytes and an AT as referenced tags', () => {
    const dataset = readDicomDataset(
      buildSlice({ extraElements: MIXED_VR_ELEMENTS })
    );

    expect(valuesOf(dataset, ICC_PROFILE)).toEqual({
      kind: 'bytes',
      values: [new Uint8Array(8).fill(0x7f)],
    });
    expect(valuesOf(dataset, FRAME_DIMENSION_POINTER)).toEqual({
      kind: 'attributeTag',
      values: [
        { group: 0x0018, element: 0x1063 },
        { group: 0x0028, element: 0x00ff },
      ],
    });
  });

  it('applies the declared character set to the VRs it reaches', () => {
    const dataset = readDicomDataset(
      buildSlice({
        specificCharacterSet: 'ISO_IR 192',
        patientNameBytes: UTF8_NAME_BYTES,
      })
    );

    expect(dataset.specificCharacterSet).toEqual(['ISO_IR 192']);
    expect(valuesOf(dataset, PATIENT_NAME)).toEqual({
      kind: 'text',
      values: [UTF8_NAME],
    });
  });

  it.each([
    ['LO', 0x0038, 0x0300, CURRENT_PATIENT_LOCATION],
    ['PN', 0x0008, 0x1050, PERFORMING_PHYSICIAN_NAME],
  ])(
    'separates %s values on a delimiter, not on a multibyte character',
    (vr, group, element, tag) => {
      const dataset = readDicomDataset(
        buildSlice({
          specificCharacterSet: 'GB18030',
          extraElements: [
            rawElement(
              group,
              element,
              vr,
              new Uint8Array([0x81, 0x5c, 0x5c, 0x81, 0x40])
            ),
          ],
        })
      );

      expect(valuesOf(dataset, tag)).toEqual({
        kind: 'text',
        values: ['\u4e57', '\u4e02 '],
      });
    }
  );

  it('keeps a backslash inside a single valued text VR as a character', () => {
    const dataset = readDicomDataset(
      buildSlice({
        extraElements: [rawElement(0x0032, 0x4000, 'LT', ascii('C:\\DICOM'))],
      })
    );

    expect(valuesOf(dataset, STUDY_COMMENTS)).toEqual({
      kind: 'text',
      values: ['C:\\DICOM'],
    });
  });

  it('reports a missing attribute as missing rather than as a default', () => {
    const dataset = readDicomDataset(buildSlice());

    expect(dataset.specificCharacterSet).toBeNull();
    expect(findElement(dataset, SPECIFIC_CHARACTER_SET)).toBeUndefined();
    expect(findElement(dataset, ICC_PROFILE)).toBeUndefined();
  });
});
