import {
  attributeTagValue,
  buildSyntheticCineDicom,
  buildSyntheticDicom,
  rawElement,
  SyntheticSliceOptions,
  undefinedLengthItem,
  undefinedLengthSequence,
} from '@/tests/specs/syntheticDicom';

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  parts.reduce((offset, part) => {
    out.set(part, offset);
    return offset + part.length;
  }, 0);
  return out;
};

const bytes = (...values: number[]) => new Uint8Array(values);
const ascii = (text: string) => new TextEncoder().encode(text);

// ESC $ B designates JIS X 0208, ESC ( B returns to ASCII, as ISO 2022 IR 87
// requires around every run of ideographic or phonetic characters.
const jisX0208 = (...codes: number[]) =>
  bytes(0x1b, 0x24, 0x42, ...codes, 0x1b, 0x28, 0x42);

const JAPANESE_CHARACTER_SET = 'ISO 2022 IR 6\\ISO 2022 IR 87';

export const JAPANESE_NAME = 'Yamada^Tarou=山田^太郎=やまだ^たろう';
export const JAPANESE_NAME_BYTES = concat(
  ascii('Yamada^Tarou='),
  jisX0208(0x3b, 0x33, 0x45, 0x44),
  ascii('^'),
  jisX0208(0x42, 0x40, 0x4f, 0x3a),
  ascii('='),
  jisX0208(0x24, 0x64, 0x24, 0x5e, 0x24, 0x40),
  ascii('^'),
  jisX0208(0x24, 0x3f, 0x24, 0x6d, 0x24, 0x26)
);

// ISO 2022 IR 149 carries KS X 1001 in the high half, no escape needed.
export const KOREAN_NAME = 'Hong^Gildong=洪^吉洞=홍^길동';
export const KOREAN_NAME_BYTES = concat(
  ascii('Hong^Gildong='),
  bytes(0xfb, 0xf3),
  ascii('^'),
  bytes(0xd1, 0xce, 0xd4, 0xd7),
  ascii('='),
  bytes(0xc8, 0xab),
  ascii('^'),
  bytes(0xb1, 0xe6, 0xb5, 0xbf)
);

// GB 2312 in the high half. Odd length, so DICOM pads it with a space.
export const CHINESE_NAME_PADDED = '王^小明 ';
export const CHINESE_NAME_BYTES = concat(
  bytes(0xcd, 0xf5),
  ascii('^'),
  bytes(0xd0, 0xa1, 0xc3, 0xf7)
);

// 0x81 0x39 0xee 0x39 is a four-byte GB18030 code no two-byte charset reaches.
export const GB18030_NAME_PADDED = '王^㐀 ';
export const GB18030_NAME_BYTES = concat(
  bytes(0xcd, 0xf5),
  ascii('^'),
  bytes(0x81, 0x39, 0xee, 0x39)
);

export const UTF8_NAME = 'Wang^Xiaoming=王^小明';
export const UTF8_NAME_BYTES = ascii(UTF8_NAME);

export const LATIN1_NAME_PADDED = 'Bäcker^Jörg ';
export const LATIN1_NAME_BYTES = bytes(
  0x42,
  0xe4,
  0x63,
  0x6b,
  0x65,
  0x72,
  0x5e,
  0x4a,
  0xf6,
  0x72,
  0x67
);

const doubles = (...values: number[]) => {
  const out = new Uint8Array(values.length * 8);
  const view = new DataView(out.buffer);
  values.forEach((value, i) => view.setFloat64(i * 8, value, true));
  return out;
};

const floats = (...values: number[]) => {
  const out = new Uint8Array(values.length * 4);
  const view = new DataView(out.buffer);
  values.forEach((value, i) => view.setFloat32(i * 4, value, true));
  return out;
};

/**
 * Elements the named writers cannot emit: a binary buffer VR, an attribute tag,
 * binary floats, and the private elements every clinical vendor writes. Tags
 * sort after (0028,1053) so the data set stays ascending.
 */
export const KATAKANA_NAME = 'ｱｲｳ^ｴｵ';
export const KATAKANA_NAME_BYTES = bytes(0xb1, 0xb2, 0xb3, 0x5e, 0xb4, 0xb5);

// Half width katakana and JIS X 0208 runs in one value, which ISO 2022 allows
// and no single decoder covers. GDCM stopped at the first escape here, so this
// fixture stays out of the differential corpus.
export const MIXED_JIS_NAME = 'ﾔﾏﾀﾞ^ﾀﾛｳ=山田^太郎';
export const MIXED_JIS_NAME_BYTES = concat(
  bytes(0xd4, 0xcf, 0xc0, 0xde),
  ascii('^'),
  bytes(0xc0, 0xdb, 0xb3),
  ascii('='),
  jisX0208(0x3b, 0x33, 0x45, 0x44),
  ascii('^'),
  jisX0208(0x42, 0x40, 0x4f, 0x3a)
);

export const MIXED_VR_ELEMENTS = [
  // (0028,2000) ICC Profile, OB.
  rawElement(0x0028, 0x2000, 'OB', new Uint8Array(8).fill(0x7f)),
  // (0028,9445) is FL in the dictionary; written UN, as a vendor would.
  rawElement(0x0028, 0x9445, 'UN', bytes(0x01, 0x02, 0x03, 0x04)),
  // Odd groups, which every clinical vendor writes and GDCM never reported.
  rawElement(0x0029, 0x0010, 'LO', ascii('SIEMENS CSA HEADER  ')),
  rawElement(0x0029, 0x1010, 'OB', new Uint8Array(6).fill(0x41)),
  rawElement(0x0029, 0x1020, 'UN', new Uint8Array(4).fill(0x02)),
  rawElement(0x0009, 0x1001, 'SH', ascii('GEPRIV  ')),
  // (0018,9087) Diffusion b-value FD, (0018,9089) gradient orientation FD x 3.
  rawElement(0x0018, 0x9087, 'FD', doubles(1234567)),
  rawElement(0x0018, 0x9089, 'FD', doubles(3, 0.000012345678, -0.1 - 0.2)),
  // (0028,9459) LUT Frame Range, FL.
  rawElement(0x0028, 0x9459, 'FL', floats(-2.5, 1e-30)),
  // (0028,0009) Frame Increment Pointer, AT, single and multi valued.
  rawElement(0x0028, 0x0009, 'AT', attributeTagValue(0x0018, 0x10ab)),
  rawElement(
    0x0028,
    0x000a,
    'AT',
    concat(attributeTagValue(0x0018, 0x1063), attributeTagValue(0x0028, 0x00ff))
  ),
];

/** Fixed UIDs, so a fixture's tag values are the same on every run. */
export const sliceOptions = (
  overrides: Partial<SyntheticSliceOptions> = {}
): SyntheticSliceOptions => ({
  studyUid: '1.2.826.0.1.3680043.10.999.1',
  seriesUid: '1.2.826.0.1.3680043.10.999.2',
  sopUid: '1.2.826.0.1.3680043.10.999.3',
  instanceNumber: 1,
  imageOrientationPatient: [1, 0, 0, 0, 1, 0],
  imagePositionPatient: [0, 0, 0],
  ...overrides,
});

export const buildSlice = (overrides: Partial<SyntheticSliceOptions> = {}) =>
  buildSyntheticDicom(sliceOptions(overrides));

/**
 * Every shape `tests/specs/syntheticDicom.ts` can emit, one entry per encoding
 * or value-formatting concern the tag reader has to get right. `itkDivergence`
 * names the tags where the itk-wasm reader is known to depart from the
 * standard, with the value this reader returns instead.
 */
export const tagReaderCorpus = (): Array<{
  name: string;
  bytes: Uint8Array;
  itkDivergence?: Record<string, string>;
}> => [
  { name: 'explicit VR little endian', bytes: buildSlice() },
  {
    name: 'implicit VR little endian',
    bytes: buildSlice({ implicitVr: true }),
  },
  {
    name: '8 bit pixels',
    bytes: buildSlice({
      bitsAllocated: 8,
      bitsStored: 8,
      highBit: 7,
      rows: 3,
      cols: 5,
      pixelValue: 3,
    }),
  },
  {
    name: 'signed pixels',
    bytes: buildSlice({ pixelRepresentation: 1, pixelValue: 0xfff0 }),
  },
  {
    name: 'rescale, slice spacing and a CT modality',
    bytes: buildSlice({
      modality: 'CT',
      rescaleSlope: 2.5,
      rescaleIntercept: -1024,
      spacingBetweenSlices: 1.5,
      sliceThickness: 2,
    }),
  },
  {
    name: 'fractional and negative geometry',
    bytes: buildSlice({
      imageOrientationPatient: [1, 0, 0, 0, -1, 0],
      imagePositionPatient: [1.5, -2, 3],
      pixelSpacing: [0.5, 0.75],
    }),
  },
  {
    name: 'odd length UIDs and a person name',
    bytes: buildSlice({
      studyUid: '1.2.3',
      seriesUid: '1.2.4',
      sopUid: '1.2.5',
      patientName: 'DOE^JOHN',
    }),
  },
  {
    name: 'zero length patient name',
    bytes: buildSlice({ patientNameBytes: new Uint8Array(0) }),
  },
  {
    name: 'ultrasound region sequence',
    bytes: buildSlice({
      ultrasoundRegion: { physicalDeltaX: 0.1, physicalDeltaY: 0.2 },
    }),
  },
  {
    name: 'implicit VR ultrasound region sequence',
    bytes: buildSlice({
      implicitVr: true,
      ultrasoundRegion: { physicalDeltaX: 0.1, physicalDeltaY: 0.2 },
    }),
  },
  {
    name: 'ISO 2022 IR 87 japanese name',
    bytes: buildSlice({
      specificCharacterSet: JAPANESE_CHARACTER_SET,
      patientNameBytes: JAPANESE_NAME_BYTES,
    }),
  },
  {
    // A sequence item may declare a character set of its own, which every
    // Japanese and Korean study writes as a default plus an extension.
    name: 'ISO 2022 IR 87 japanese name with a sequence item character set',
    bytes: buildSlice({
      specificCharacterSet: JAPANESE_CHARACTER_SET,
      patientNameBytes: JAPANESE_NAME_BYTES,
      extraElements: [
        undefinedLengthSequence(
          0x0040,
          0x0275,
          undefinedLengthItem(
            concat(
              rawElement(0x0008, 0x0005, 'CS', ascii(JAPANESE_CHARACTER_SET)),
              rawElement(0x0010, 0x0010, 'PN', JAPANESE_NAME_BYTES)
            )
          )
        ),
      ],
    }),
  },
  {
    name: 'ISO 2022 IR 149 korean name',
    bytes: buildSlice({
      specificCharacterSet: 'ISO 2022 IR 6\\ISO 2022 IR 149',
      patientNameBytes: KOREAN_NAME_BYTES,
    }),
  },
  {
    name: 'ISO 2022 IR 58 chinese name',
    bytes: buildSlice({
      specificCharacterSet: 'ISO 2022 IR 6\\ISO 2022 IR 58',
      patientNameBytes: CHINESE_NAME_BYTES,
    }),
  },
  {
    name: 'GB18030 chinese name',
    bytes: buildSlice({
      specificCharacterSet: 'GB18030',
      patientNameBytes: GB18030_NAME_BYTES,
    }),
  },
  {
    name: 'ISO_IR 192 utf-8 name',
    bytes: buildSlice({
      specificCharacterSet: 'ISO_IR 192',
      patientNameBytes: UTF8_NAME_BYTES,
    }),
  },
  {
    name: 'ISO_IR 100 latin-1 name',
    bytes: buildSlice({
      specificCharacterSet: 'ISO_IR 100',
      patientNameBytes: LATIN1_NAME_BYTES,
    }),
  },
  {
    name: 'binary, attribute tag, float and private elements',
    bytes: buildSlice({ extraElements: MIXED_VR_ELEMENTS }),
  },
  {
    name: 'implicit VR binary, attribute tag, float and private elements',
    bytes: buildSlice({ implicitVr: true, extraElements: MIXED_VR_ELEMENTS }),
  },
  {
    name: 'ISO 2022 IR 13 half width katakana name',
    bytes: buildSlice({
      specificCharacterSet: 'ISO 2022 IR 13\\ISO 2022 IR 87',
      patientNameBytes: KATAKANA_NAME_BYTES,
    }),
    // GDCM converted every string VR under the declared character set, so its
    // CS and DS values carry the JIS X 0201 yen sign where the file wrote the
    // 0x5c value delimiter. PS3.5 6.1.2 limits that conversion to SH, LO, ST,
    // PN, LT, UC and UT, and the delimiter is never part of a value.
    itkDivergence: {
      '0008|0005': 'ISO 2022 IR 13\\ISO 2022 IR 87 ',
      '0020|0032': '0\\0\\0 ',
      '0020|0037': '1\\0\\0\\0\\1\\0 ',
      '0028|0030': '1\\1 ',
    },
  },
  {
    name: 'multi frame cine',
    bytes: buildSyntheticCineDicom({
      studyUid: '1.2.826.0.1.3680043.10.999.4',
      seriesUid: '1.2.826.0.1.3680043.10.999.5',
      sopUid: '1.2.826.0.1.3680043.10.999.6',
    }),
  },
];
