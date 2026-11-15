import { describe, expect, it } from 'vitest';
import { getDatasetTag } from '../datasetAccess';
import { readDicomDataset } from '../dicomDataset';
import { Tags } from '../dicomTags';
import {
  buildSlice,
  CHINESE_NAME_BYTES,
  CHINESE_NAME_PADDED,
  GB18030_NAME_BYTES,
  GB18030_NAME_PADDED,
  JAPANESE_NAME,
  JAPANESE_NAME_BYTES,
  KATAKANA_NAME,
  KATAKANA_NAME_BYTES,
  KOREAN_NAME,
  KOREAN_NAME_BYTES,
  LATIN1_NAME_BYTES,
  LATIN1_NAME_PADDED,
  MIXED_JIS_NAME,
  MIXED_JIS_NAME_BYTES,
} from '@/tests/specs/dicomElementFixtures';
import { rawElement } from '@/tests/specs/syntheticDicom';

const CURRENT_PATIENT_LOCATION = '0038|0300';
const STUDY_COMMENTS = '0032|4000';
const JIS = 'ISO 2022 IR 13\\ISO 2022 IR 87';

const encodeUtf8 = (text: string) => new TextEncoder().encode(text);

const read = (...options: Parameters<typeof buildSlice>) => {
  const dataset = readDicomDataset(buildSlice(...options));
  return (tag: string) => getDatasetTag(dataset, tag);
};

// (0038,0300) is LO, whose value multiplicity is 1-n.
const patientLocation = (value: Uint8Array) =>
  rawElement(0x0038, 0x0300, 'LO', value);

describe('DICOM text in a declared character set', () => {
  it.each([
    ['ISO 2022 IR 6\\ISO 2022 IR 87', JAPANESE_NAME_BYTES, JAPANESE_NAME],
    ['ISO 2022 IR 6\\ISO 2022 IR 149', KOREAN_NAME_BYTES, KOREAN_NAME],
    ['ISO 2022 IR 6\\ISO 2022 IR 58', CHINESE_NAME_BYTES, CHINESE_NAME_PADDED],
    ['GB18030', GB18030_NAME_BYTES, GB18030_NAME_PADDED],
    ['ISO_IR 100', LATIN1_NAME_BYTES, LATIN1_NAME_PADDED],
    [JIS, KATAKANA_NAME_BYTES, KATAKANA_NAME],
    [JIS, MIXED_JIS_NAME_BYTES, MIXED_JIS_NAME],
  ])(
    'decodes a patient name written in %s',
    (specificCharacterSet, patientNameBytes, name) => {
      expect(
        read({ specificCharacterSet, patientNameBytes })(Tags.PatientName)
      ).toBe(name);
    }
  );

  // A backslash inside an LT is a character, not a value delimiter.
  it('renders 0x5c as a yen sign inside an LT when JIS X 0201 is declared', () => {
    const tag = read({
      specificCharacterSet: JIS,
      extraElements: [
        rawElement(0x0032, 0x4000, 'LT', encodeUtf8('C:\\DICOM')),
      ],
    });

    expect(tag(STUDY_COMMENTS)).toBe('C:\u00a5DICOM');
  });

  it('keeps a numeric VR out of the character set conversion', () => {
    const tag = read({
      specificCharacterSet: JIS,
      patientNameBytes: MIXED_JIS_NAME_BYTES,
      imageOrientationPatient: [1, 0, 0, 0, -1, 0],
      imagePositionPatient: [1.5, -2, 3],
      pixelSpacing: [0.5, 0.75],
    });

    expect(tag(Tags.PatientName)).toBe(MIXED_JIS_NAME);
    expect(tag(Tags.ImageOrientationPatient)).toBe('1\\0\\0\\0\\-1\\0');
    expect(tag(Tags.ImagePositionPatient)).toBe('1.5\\-2\\3');
    expect(tag(Tags.PixelSpacing)).toBe('0.5\\0.75');
  });

  it('decodes each value of a multi valued LO on its own', () => {
    const latin1 = read({
      specificCharacterSet: 'ISO_IR 100',
      extraElements: [
        patientLocation(
          Uint8Array.of(
            ...[0x42, 0xe4, 0x63, 0x6b, 0x65, 0x72, 0x5c],
            ...[0x4a, 0xf6, 0x72, 0x67, 0x20]
          )
        ),
      ],
    });
    const utf8 = read({
      specificCharacterSet: 'ISO_IR 192',
      extraElements: [patientLocation(encodeUtf8('\u738b\\\u5c0f\u660e'))],
    });

    expect(latin1(CURRENT_PATIENT_LOCATION)).toBe('B\u00e4cker\\J\u00f6rg ');
    expect(utf8(CURRENT_PATIENT_LOCATION)).toBe('\u738b\\\u5c0f\u660e');
  });
});
