import { describe, expect, it } from 'vitest';
import { Tags } from '@/src/core/dicomTags';
import { readInstanceFacts } from '@/src/core/dicom/instanceFacts';
import { readDicomTags } from '@/src/io/readDicomTags';
import {
  buildSlice,
  CHINESE_NAME_BYTES,
  CHINESE_NAME_PADDED,
  GB18030_NAME_BYTES,
  GB18030_NAME_PADDED,
  JAPANESE_NAME,
  KATAKANA_NAME,
  KATAKANA_NAME_BYTES,
  MIXED_JIS_NAME,
  MIXED_JIS_NAME_BYTES,
  MIXED_VR_ELEMENTS,
  JAPANESE_NAME_BYTES,
  KOREAN_NAME,
  KOREAN_NAME_BYTES,
  LATIN1_NAME_BYTES,
  LATIN1_NAME_PADDED,
  UTF8_NAME,
  UTF8_NAME_BYTES,
} from './readDicomTagsFixtures';
import {
  buildSyntheticCineDicom,
  rawElement,
  stripFileMeta,
  stripPreamble,
} from '@/tests/specs/syntheticDicom';

type TagPairs = ReadonlyArray<readonly [string, string]>;

const valueOf = (tags: TagPairs, tag: string) =>
  tags.find(([name]) => name === tag)?.[1];

const keysOf = (tags: TagPairs) => tags.map(([name]) => name);

const SPECIFIC_CHARACTER_SET = '0008|0005';
const ICC_PROFILE = '0028|2000';
const FRAME_INCREMENT_POINTER = '0028|0009';
const FRAME_DIMENSION_POINTER = '0028|000a';
const DIFFUSION_B_VALUE = '0018|9087';
const DIFFUSION_GRADIENT_ORIENTATION = '0018|9089';
const LUT_FRAME_RANGE = '0028|9459';
const PIXEL_DATA = '7fe0|0010';
const SEQUENCE_ITEM = 'fffe|e000';
const CURRENT_PATIENT_LOCATION = '0038|0300';
const STUDY_COMMENTS = '0032|4000';

const encodeUtf8 = (text: string) => new TextEncoder().encode(text);

const bytes = (...values: number[]) => new Uint8Array(values);

// A backslash inside an LT is a literal character, not a value delimiter, so it
// is the one place a JIS X 0201 file can show the yen sign.
const studyComments = (value: Uint8Array) =>
  rawElement(0x0032, 0x4000, 'LT', value);

// (0038,0300) is LO, whose value multiplicity is 1-n.
const patientLocation = (value: Uint8Array) =>
  rawElement(0x0038, 0x0300, 'LO', value);

const nameFromCharacterSet = async (
  specificCharacterSet: string,
  patientNameBytes: Uint8Array
) =>
  valueOf(
    await readDicomTags(buildSlice({ specificCharacterSet, patientNameBytes })),
    Tags.PatientName
  );

describe('readDicomTags', () => {
  it('keys every pair with a lowercase group|element tag', async () => {
    const tags = await readDicomTags(buildSlice());

    expect(keysOf(tags).length).toBeGreaterThan(0);
    expect(
      keysOf(tags).filter((tag) => !/^[0-9a-f]{4}\|[0-9a-f]{4}$/.test(tag))
    ).toEqual([]);
    expect(keysOf(tags)).toContain(Tags.SOPInstanceUID);
  });

  it('stringifies binary numeric VRs as plain decimals', async () => {
    const tags = await readDicomTags(
      buildSlice({
        rows: 3,
        cols: 5,
        bitsAllocated: 8,
        bitsStored: 8,
        highBit: 7,
      })
    );

    expect(valueOf(tags, Tags.Rows)).toBe('3');
    expect(valueOf(tags, Tags.Columns)).toBe('5');
    expect(valueOf(tags, Tags.BitsAllocated)).toBe('8');
    expect(valueOf(tags, Tags.BitsStored)).toBe('8');
    expect(valueOf(tags, Tags.SamplesPerPixel)).toBe('1');
    expect(valueOf(tags, Tags.PixelRepresentation)).toBe('0');
  });

  it("joins multiple values with DICOM's own backslash", async () => {
    const tags = await readDicomTags(
      buildSlice({
        imageOrientationPatient: [1, 0, 0, 0, -1, 0],
        imagePositionPatient: [1.5, -2, 3],
        pixelSpacing: [0.5, 0.75],
      })
    );

    expect(valueOf(tags, Tags.ImagePositionPatient)).toBe('1.5\\-2\\3');
    expect(valueOf(tags, Tags.ImageOrientationPatient)).toBe(
      '1\\0\\0\\0\\-1\\0'
    );
    expect(valueOf(tags, Tags.PixelSpacing)).toBe('0.5\\0.75');
  });

  it('keeps the trailing space padding of a text VR', async () => {
    const tags = await readDicomTags(
      buildSlice({ patientId: 'TEST001', seriesNumber: 1 })
    );

    expect(valueOf(tags, Tags.PatientID)).toBe('TEST001 ');
    expect(valueOf(tags, Tags.SeriesNumber)).toBe('1 ');
    expect(valueOf(tags, Tags.ImagePositionPatient)).toBe('0\\0\\0 ');
  });

  it('strips the null padding of a UI value', async () => {
    const tags = await readDicomTags(
      buildSlice({ studyUid: '1.2.3', seriesUid: '1.2.4', sopUid: '1.2.5' })
    );

    expect(valueOf(tags, Tags.StudyInstanceUID)).toBe('1.2.3');
    expect(valueOf(tags, Tags.SeriesInstanceUID)).toBe('1.2.4');
    expect(valueOf(tags, Tags.SOPInstanceUID)).toBe('1.2.5');
  });

  it('passes a person name through unchanged', async () => {
    const tags = await readDicomTags(buildSlice({ patientName: 'DOE^JOHN' }));

    expect(valueOf(tags, Tags.PatientName)).toBe('DOE^JOHN');
  });

  it('reports a zero length element as an empty value', async () => {
    const tags = await readDicomTags(
      buildSlice({ patientNameBytes: new Uint8Array(0) })
    );

    expect(keysOf(tags)).toContain(Tags.PatientName);
    expect(valueOf(tags, Tags.PatientName)).toBe('');
  });

  it('reports an empty character set when the file declares none', async () => {
    const tags = await readDicomTags(buildSlice());

    expect(keysOf(tags)).toContain(SPECIFIC_CHARACTER_SET);
    expect(valueOf(tags, SPECIFIC_CHARACTER_SET)).toBe('');
  });

  it('omits the file meta group', async () => {
    const tags = await readDicomTags(buildSlice());

    expect(keysOf(tags).filter((tag) => tag.startsWith('0002|'))).toEqual([]);
  });

  it('omits pixel data', async () => {
    const tags = await readDicomTags(buildSlice());

    expect(keysOf(tags)).not.toContain(PIXEL_DATA);
  });

  it('reads the header of a file truncated inside pixel data', async () => {
    const whole = buildSlice({ rows: 4, cols: 4, bitsAllocated: 16 });
    // Drops all 32 pixel bytes and keeps the element header, so only a reader
    // that stops at the pixel data tag can still return the header.
    const truncated = whole.slice(0, whole.length - 4 * 4 * 2);

    expect(await readDicomTags(truncated)).toEqual(await readDicomTags(whole));
  });

  it('omits sequences and the elements nested in them', async () => {
    const tags = await readDicomTags(
      buildSlice({
        ultrasoundRegion: { physicalDeltaX: 0.1, physicalDeltaY: 0.2 },
      })
    );

    expect(keysOf(tags)).not.toContain(Tags.SequenceOfUltrasoundRegions);
    expect(keysOf(tags)).not.toContain(Tags.PhysicalDeltaX);
    expect(keysOf(tags)).not.toContain(SEQUENCE_ITEM);
    expect(tags).toEqual(await readDicomTags(buildSlice()));
  });

  it('reads an implicit VR dataset the same as an explicit VR one', async () => {
    expect(await readDicomTags(buildSlice({ implicitVr: true }))).toEqual(
      await readDicomTags(buildSlice())
    );
  });

  it('orders the pairs by tag', async () => {
    // The cine fixture writes SeriesDescription after the 0028 group.
    const tags = await readDicomTags(
      buildSyntheticCineDicom({
        studyUid: '1.2.826.0.1.3680043.10.999.4',
        seriesUid: '1.2.826.0.1.3680043.10.999.5',
        sopUid: '1.2.826.0.1.3680043.10.999.6',
      })
    );

    expect(keysOf(tags)).toContain(Tags.SeriesDescription);
    expect(keysOf(tags)).toEqual([...keysOf(tags)].sort());
  });

  it('base64 encodes a binary buffer VR', async () => {
    const tags = await readDicomTags(
      buildSlice({ extraElements: MIXED_VR_ELEMENTS })
    );

    expect(valueOf(tags, ICC_PROFILE)).toBe('f39/f39/f38=');
  });

  it('writes an attribute tag value as a parenthesised tag', async () => {
    const tags = await readDicomTags(
      buildSlice({ extraElements: MIXED_VR_ELEMENTS })
    );

    expect(valueOf(tags, FRAME_INCREMENT_POINTER)).toBe('(0018,10ab)');
    expect(valueOf(tags, FRAME_DIMENSION_POINTER)).toBe(
      '(0018,1063)\\(0028,00ff)'
    );
  });

  it('prints a binary float to six significant digits', async () => {
    const tags = await readDicomTags(
      buildSlice({ extraElements: MIXED_VR_ELEMENTS })
    );

    expect(valueOf(tags, DIFFUSION_B_VALUE)).toBe('1.23457e+06');
    expect(valueOf(tags, DIFFUSION_GRADIENT_ORIENTATION)).toBe(
      '3\\1.23457e-05\\-0.3'
    );
    expect(valueOf(tags, LUT_FRAME_RANGE)).toBe('-2.5\\1e-30');
  });

  it('omits private elements', async () => {
    const tags = await readDicomTags(
      buildSlice({ extraElements: MIXED_VR_ELEMENTS })
    );

    expect(
      keysOf(tags).filter(
        (tag) => (Number.parseInt(tag.slice(0, 4), 16) & 1) === 1
      )
    ).toEqual([]);
  });

  it('reads a view that does not start at the head of its buffer', async () => {
    const whole = buildSlice();
    const padded = new Uint8Array(whole.length + 3);
    padded.set(whole, 3);

    expect(await readDicomTags(padded.subarray(3))).toEqual(
      await readDicomTags(whole)
    );
  });

  it('rejects a buffer that is not a DICOM file', async () => {
    const notDicom = new Uint8Array(256).fill(0x41);

    await expect(
      Promise.resolve().then(() => readDicomTags(notDicom))
    ).rejects.toThrow();
  });
});

describe('readDicomTags specific character set', () => {
  it('keeps the declared character set as its own padded value', async () => {
    const tags = await readDicomTags(
      buildSlice({
        specificCharacterSet: 'ISO 2022 IR 6\\ISO 2022 IR 149',
        patientNameBytes: KOREAN_NAME_BYTES,
      })
    );

    expect(valueOf(tags, SPECIFIC_CHARACTER_SET)).toBe(
      'ISO 2022 IR 6\\ISO 2022 IR 149 '
    );
  });

  it('decodes ISO 2022 IR 87', async () => {
    expect(
      await nameFromCharacterSet(
        'ISO 2022 IR 6\\ISO 2022 IR 87',
        JAPANESE_NAME_BYTES
      )
    ).toBe(JAPANESE_NAME);
  });

  it('decodes ISO 2022 IR 149', async () => {
    expect(
      await nameFromCharacterSet(
        'ISO 2022 IR 6\\ISO 2022 IR 149',
        KOREAN_NAME_BYTES
      )
    ).toBe(KOREAN_NAME);
  });

  it('decodes ISO 2022 IR 58', async () => {
    expect(
      await nameFromCharacterSet(
        'ISO 2022 IR 6\\ISO 2022 IR 58',
        CHINESE_NAME_BYTES
      )
    ).toBe(CHINESE_NAME_PADDED);
  });

  it('decodes GB18030, four byte code points included', async () => {
    expect(await nameFromCharacterSet('GB18030', GB18030_NAME_BYTES)).toBe(
      GB18030_NAME_PADDED
    );
  });

  it('decodes ISO_IR 192', async () => {
    expect(await nameFromCharacterSet('ISO_IR 192', UTF8_NAME_BYTES)).toBe(
      UTF8_NAME
    );
  });

  it('decodes ISO 2022 IR 13 half width katakana', async () => {
    expect(
      await nameFromCharacterSet(
        'ISO 2022 IR 13\\ISO 2022 IR 87',
        KATAKANA_NAME_BYTES
      )
    ).toBe(KATAKANA_NAME);
  });

  it('decodes a value that switches between IR 13 and IR 87', async () => {
    expect(
      await nameFromCharacterSet(
        'ISO 2022 IR 13\\ISO 2022 IR 87',
        MIXED_JIS_NAME_BYTES
      )
    ).toBe(MIXED_JIS_NAME);
  });

  it('renders 0x5c as a yen sign inside an LT when JIS X 0201 is declared', async () => {
    const tags = await readDicomTags(
      buildSlice({
        specificCharacterSet: 'ISO 2022 IR 13\\ISO 2022 IR 87',
        extraElements: [studyComments(encodeUtf8('C:\\DICOM'))],
      })
    );

    expect(valueOf(tags, STUDY_COMMENTS)).toBe('C:\u00a5DICOM');
  });

  it('keeps a numeric VR out of the character set conversion', async () => {
    const tags = await readDicomTags(
      buildSlice({
        specificCharacterSet: 'ISO 2022 IR 13\\ISO 2022 IR 87',
        patientNameBytes: MIXED_JIS_NAME_BYTES,
        imageOrientationPatient: [1, 0, 0, 0, -1, 0],
        imagePositionPatient: [1.5, -2, 3],
        pixelSpacing: [0.5, 0.75],
      })
    );

    expect(valueOf(tags, Tags.PatientName)).toBe(MIXED_JIS_NAME);
    expect(valueOf(tags, Tags.ImageOrientationPatient)).toBe(
      '1\\0\\0\\0\\-1\\0'
    );
    expect(valueOf(tags, Tags.ImagePositionPatient)).toBe('1.5\\-2\\3');
    expect(valueOf(tags, Tags.PixelSpacing)).toBe('0.5\\0.75');
    expect(readInstanceFacts(tags)).toMatchObject({
      orientation: [1, 0, 0, 0, -1, 0],
      position: [1.5, -2, 3],
      pixelSpacing: [0.5, 0.75],
    });
  });

  it('decodes each value of a multi valued LO on its own', async () => {
    const latin1 = await readDicomTags(
      buildSlice({
        specificCharacterSet: 'ISO_IR 100',
        extraElements: [
          patientLocation(
            bytes(
              0x42,
              0xe4,
              0x63,
              0x6b,
              0x65,
              0x72,
              0x5c,
              0x4a,
              0xf6,
              0x72,
              0x67,
              0x20
            )
          ),
        ],
      })
    );
    const utf8 = await readDicomTags(
      buildSlice({
        specificCharacterSet: 'ISO_IR 192',
        extraElements: [patientLocation(encodeUtf8('\u738b\\\u5c0f\u660e'))],
      })
    );

    expect(valueOf(latin1, CURRENT_PATIENT_LOCATION)).toBe(
      'B\u00e4cker\\J\u00f6rg '
    );
    expect(valueOf(latin1, CURRENT_PATIENT_LOCATION)?.split('\\')).toEqual([
      'B\u00e4cker',
      'J\u00f6rg ',
    ]);
    expect(valueOf(utf8, CURRENT_PATIENT_LOCATION)).toBe(
      '\u738b\\\u5c0f\u660e'
    );
    expect(valueOf(utf8, CURRENT_PATIENT_LOCATION)?.split('\\')).toEqual([
      '\u738b',
      '\u5c0f\u660e',
    ]);
  });

  it('keeps a multibyte character whose trailing byte delimits values', async () => {
    const tags = await readDicomTags(
      buildSlice({
        specificCharacterSet: 'GB18030',
        extraElements: [patientLocation(bytes(0x81, 0x5c, 0x5c, 0x81, 0x40))],
      })
    );

    // GB18030 writes 0x5c as the second byte of a character, so only the lone
    // one between the two characters separates values.
    expect(valueOf(tags, CURRENT_PATIENT_LOCATION)).toBe('\u4e57\\\u4e02 ');
  });

  it('decodes ISO_IR 100', async () => {
    expect(await nameFromCharacterSet('ISO_IR 100', LATIN1_NAME_BYTES)).toBe(
      LATIN1_NAME_PADDED
    );
  });
});

describe('readDicomTags without a Part 10 header', () => {
  it('reads a file with no preamble as the Part 10 file it came from', () => {
    const file = buildSlice({ patientName: 'DOE^JOHN' });

    expect(readDicomTags(stripPreamble(file))).toEqual(readDicomTags(file));
  });

  it.each([
    ['explicit', false],
    ['implicit', true],
  ])(
    'reads a bare %s VR data set as the Part 10 file it came from',
    (_kind, implicitVr) => {
      const file = buildSlice({ patientName: 'DOE^JOHN', implicitVr });

      const tags = readDicomTags(stripFileMeta(file));

      expect(tags).toEqual(readDicomTags(file));
      expect(valueOf(tags, Tags.PatientName)).toBe('DOE^JOHN');
    }
  );

  it('rejects bytes that open with no element at all', () => {
    expect(() => readDicomTags(new Uint8Array(512))).toThrow(/Not DICOM/);
  });
});
