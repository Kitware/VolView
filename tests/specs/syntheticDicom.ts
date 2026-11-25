// Synthetic Part 10 DICOM files for tests, written in Explicit VR Little Endian
// unless a writer says otherwise.

const SOP_CLASS_MR = '1.2.840.10008.5.1.4.1.1.4';
const SOP_CLASS_ULTRASOUND_MULTIFRAME = '1.2.840.10008.5.1.4.1.1.3.1';
const TS_EXPLICIT_VR_LE = '1.2.840.10008.1.2.1';
const TS_IMPLICIT_VR_LE = '1.2.840.10008.1.2';
const TS_JPEG_BASELINE = '1.2.840.10008.1.2.4.50';

const enc = new TextEncoder();

const writeShort = (v: number) => {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, v, true);
  return b;
};

const writeLong = (v: number) => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, v, true);
  return b;
};

const writeDouble = (v: number) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setFloat64(0, v, true);
  return b;
};

const tagBytes = (group: number, element: number) => {
  const b = new Uint8Array(4);
  const dv = new DataView(b.buffer);
  dv.setUint16(0, group, true);
  dv.setUint16(2, element, true);
  return b;
};

export const combine = (...arr: Uint8Array[]) => {
  const total = arr.reduce((acc, a) => acc + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arr) {
    out.set(a, off);
    off += a.length;
  }
  return out;
};

/** VRs whose explicit header has 2 reserved bytes and a 4-byte length. */
export const LONG_FORM_VRS = new Set(
  'OB OD OF OL OV OW SQ SV UC UN UR UT'.split(' ')
);

export const elementHeader = (
  group: number,
  element: number,
  vr: string,
  length: number
) =>
  combine(
    tagBytes(group, element),
    enc.encode(vr),
    ...(LONG_FORM_VRS.has(vr)
      ? [new Uint8Array(2), writeLong(length)]
      : [writeShort(length)])
  );

/** One Explicit VR LE element, short or long form as the VR requires. */
export const rawElement = (
  group: number,
  element: number,
  vr: string,
  value: Uint8Array
) => combine(elementHeader(group, element, vr, value.length), value);

const textElement =
  (vr: string) => (group: number, element: number, value: string) =>
    rawElement(
      group,
      element,
      vr,
      enc.encode(value.length % 2 ? value + (vr === 'UI' ? '\0' : ' ') : value)
    );

const ui = textElement('UI');
const cs = textElement('CS');
const pn = textElement('PN');
const lo = textElement('LO');
const sh = textElement('SH');
const da = textElement('DA');
const is = textElement('IS');
export const ds = textElement('DS');
const us = (g: number, e: number, v: number) =>
  rawElement(g, e, 'US', writeShort(v));
export const ul = (g: number, e: number, v: number) =>
  rawElement(g, e, 'UL', writeLong(v));
const fd = (g: number, e: number, v: number) =>
  rawElement(g, e, 'FD', writeDouble(v));

// A PN whose bytes are already encoded in some Specific Character Set, padded
// to DICOM's even length with a space.
const pnRaw = (g: number, e: number, v: Uint8Array) =>
  rawElement(
    g,
    e,
    'PN',
    v.length % 2 === 0 ? v : combine(v, new Uint8Array([0x20]))
  );

// An AT value is the referenced tag as two little-endian unsigned shorts.
export const attributeTagValue = (group: number, element: number) =>
  tagBytes(group, element);

const ITEM_GROUP = 0xfffe;
const ITEM_TAG = 0xe000;
const UNDEFINED_LENGTH = 0xffffffff;

const itemHeader = (length: number) =>
  combine(tagBytes(ITEM_GROUP, ITEM_TAG), writeLong(length));

const delimiter = (tag: number) =>
  combine(tagBytes(ITEM_GROUP, tag), writeLong(0));
const ITEM_DELIMITER = delimiter(0xe00d);
const SEQUENCE_DELIMITER = delimiter(0xe0dd);

// One sequence item of defined length, holding the elements given.
export const sequenceItem = (content: Uint8Array) =>
  combine(itemHeader(content.length), content);

/**
 * A defined-length sequence of defined-length items, so a reader that skips
 * sequences and one that descends into them both stay in step.
 */
export const sequence = (group: number, element: number, items: Uint8Array[]) =>
  rawElement(group, element, 'SQ', combine(...items.map(sequenceItem)));

// One sequence item whose length the delimiter that follows it declares.
export const undefinedLengthItem = (content: Uint8Array) =>
  combine(itemHeader(UNDEFINED_LENGTH), content, ITEM_DELIMITER);

const undefinedLengthElement = (
  group: number,
  element: number,
  vr: string,
  items: Uint8Array
) =>
  combine(
    elementHeader(group, element, vr, UNDEFINED_LENGTH),
    items,
    SEQUENCE_DELIMITER
  );

/**
 * An Explicit VR LE sequence whose length the delimiter that follows it
 * declares, the form an item's own length cannot be stepped over in. Not
 * convertible to Implicit VR by `buildSyntheticDicom`.
 */
export const undefinedLengthSequence = (
  group: number,
  element: number,
  items: Uint8Array
) => undefinedLengthElement(group, element, 'SQ', items);

/** An unknown sequence retains its Implicit VR LE items inside an explicit UN. */
export const undefinedLengthUnknown = (
  group: number,
  element: number,
  items: Uint8Array
) => undefinedLengthElement(group, element, 'UN', items);

// Items and delimiters carry no VR in either syntax, so only the elements
// inside each item change shape. Item lengths must be defined.
const itemsToImplicitVr = (value: Uint8Array): Uint8Array => {
  const view = new DataView(value.buffer, value.byteOffset, value.length);
  const out: Uint8Array[] = [];
  let offset = 0;
  while (offset < value.length) {
    const group = view.getUint16(offset, true);
    const element = view.getUint16(offset + 2, true);
    const length = view.getUint32(offset + 4, true);
    const contentStart = offset + 8;
    if (group !== ITEM_GROUP)
      throw new Error(`Expected an item tag, got ${group.toString(16)}`);
    if (element !== ITEM_TAG) {
      out.push(value.subarray(offset, contentStart));
      offset = contentStart;
      continue;
    }
    if (length === UNDEFINED_LENGTH)
      throw new Error('Undefined-length items are not supported');
    out.push(
      sequenceItem(
        toImplicitVr(value.subarray(contentStart, contentStart + length))
      )
    );
    offset = contentStart + length;
  }
  return combine(...out);
};

// Re-encodes an Explicit VR LE dataset as Implicit VR LE: tag, 4-byte length,
// value, with the VR carried only by the reader's dictionary.
export const toImplicitVr = (dataset: Uint8Array): Uint8Array => {
  const view = new DataView(dataset.buffer, dataset.byteOffset, dataset.length);
  const out: Uint8Array[] = [];
  let offset = 0;
  while (offset < dataset.length) {
    const group = view.getUint16(offset, true);
    const element = view.getUint16(offset + 2, true);
    const vr = String.fromCharCode(dataset[offset + 4], dataset[offset + 5]);
    const longForm = LONG_FORM_VRS.has(vr);
    const length = longForm
      ? view.getUint32(offset + 8, true)
      : view.getUint16(offset + 6, true);
    const valueStart = offset + (longForm ? 12 : 8);
    const explicitValue = dataset.subarray(valueStart, valueStart + length);
    const value =
      vr === 'SQ' ? itemsToImplicitVr(explicitValue) : explicitValue;
    out.push(tagBytes(group, element), writeLong(value.length), value);
    offset = valueStart + length;
  }
  return combine(...out);
};

// DICOM element values must have an even length, so an odd-sized 8-bit frame
// gets a trailing pad byte.
const frameBytes8 = (sampleCount: number, value: number) => {
  const bytes = new Uint8Array(sampleCount + (sampleCount % 2));
  bytes.fill(value & 0xff, 0, sampleCount);
  return bytes;
};

const frameBytes16 = (sampleCount: number, value: number) => {
  const bytes = new Uint8Array(sampleCount * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < sampleCount; i++)
    view.setUint16(i * 2, value & 0xffff, true);
  return bytes;
};

const rgbFrame = (samples: readonly number[], count: number, bits: number) => {
  if (bits !== 8 || samples.length !== count * 3)
    throw new Error('RGB fixtures require three 8-bit samples per pixel');
  const bytes = new Uint8Array(samples.length + (samples.length % 2));
  bytes.set(samples);
  return bytes;
};

export type SyntheticSliceOptions = {
  studyUid: string;
  seriesUid: string;
  sopUid: string;
  instanceNumber: number;
  imageOrientationPatient: readonly [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  // Null writes a zero length ImagePositionPatient, which reads as a slice
  // whose geometry is unknown.
  imagePositionPatient: readonly [number, number, number] | null;
  rows?: number;
  cols?: number;
  bitsAllocated?: number;
  bitsStored?: number;
  highBit?: number;
  pixelRepresentation?: number;
  rescaleSlope?: number;
  rescaleIntercept?: number;
  // Stored value written to every sample. Signed values are written as two's
  // complement, so they pair with pixelRepresentation 1.
  pixelValue?: number;
  // Interleaved samples for one 8-bit RGB frame.
  rgbPixels?: readonly number[];
  // One constant sample value per frame; writes NumberOfFrames when supplied.
  framePixelValues?: readonly number[];
  // Enhanced images carry these attributes in Functional Groups instead.
  rootGeometry?: boolean;
  pixelSpacing?: readonly [number, number];
  spacingBetweenSlices?: number;
  sliceThickness?: number;
  modality?: string;
  sopClassUid?: string;
  patientName?: string;
  patientId?: string;
  seriesNumber?: number;
  acquisitionNumber?: number;
  studyDate?: string;
  // (0008,0005), e.g. 'ISO 2022 IR 6\\ISO 2022 IR 87'. Omitted when absent.
  specificCharacterSet?: string;
  // PatientName bytes already encoded in specificCharacterSet, used instead of
  // patientName.
  patientNameBytes?: Uint8Array;
  // Encodes the dataset (not the file meta group) as Implicit VR LE.
  implicitVr?: boolean;
  // Writes a Sequence of Ultrasound Regions (0018,6011) holding one item.
  ultrasoundRegion?: { physicalDeltaX: number; physicalDeltaY: number };
  // Explicit VR LE element bytes, from `rawElement`, written just before Pixel
  // Data. Tags must sort after (0028,1053) to keep the data set ascending.
  extraElements?: readonly Uint8Array[];
};

/** Wraps an encoded data set in a preamble and Explicit VR LE file meta. */
export const part10File = (
  sopClassUid: string,
  sopInstanceUid: string,
  transferSyntaxUid: string,
  dataset: Uint8Array
) => {
  const meta = combine(
    rawElement(0x0002, 0x0001, 'OB', new Uint8Array([0x00, 0x01])),
    ui(0x0002, 0x0002, sopClassUid),
    ui(0x0002, 0x0003, sopInstanceUid),
    ui(0x0002, 0x0010, transferSyntaxUid)
  );
  return combine(
    new Uint8Array(128),
    enc.encode('DICM'),
    ul(0x0002, 0x0000, meta.length),
    meta,
    dataset
  );
};

export function buildSyntheticDicom(opts: SyntheticSliceOptions) {
  const {
    studyUid,
    seriesUid,
    sopUid,
    instanceNumber,
    imageOrientationPatient,
    imagePositionPatient,
    rows = 4,
    cols = 4,
    bitsAllocated = 16,
    bitsStored = bitsAllocated,
    highBit = bitsStored - 1,
    pixelRepresentation = 0,
    rescaleSlope,
    rescaleIntercept,
    pixelValue = 0,
    rgbPixels,
    framePixelValues,
    rootGeometry = true,
    pixelSpacing = [1, 1],
    spacingBetweenSlices,
    sliceThickness = 1,
    modality = 'MR',
    sopClassUid = SOP_CLASS_MR,
    patientName = 'TEST',
    patientId = 'TEST001',
    seriesNumber,
    acquisitionNumber,
    studyDate = '20260101',
    specificCharacterSet,
    patientNameBytes,
    implicitVr = false,
    ultrasoundRegion,
    extraElements = [],
  } = opts;

  if (bitsAllocated !== 8 && bitsAllocated !== 16) {
    throw new Error(
      `bitsAllocated must be 8 or 16, got ${bitsAllocated}. Other widths would need a pixel data VR this helper does not emit.`
    );
  }

  const pixels = rgbPixels
    ? rgbFrame(rgbPixels, rows * cols, bitsAllocated)
    : combine(
        ...(framePixelValues ?? [pixelValue]).map((value) =>
          bitsAllocated === 8
            ? frameBytes8(rows * cols, value)
            : frameBytes16(rows * cols, value)
        )
      );

  const explicitDataset = combine(
    ...(specificCharacterSet == null
      ? []
      : [cs(0x0008, 0x0005, specificCharacterSet)]),
    ui(0x0008, 0x0016, sopClassUid),
    ui(0x0008, 0x0018, sopUid),
    da(0x0008, 0x0020, studyDate),
    da(0x0008, 0x0021, studyDate),
    cs(0x0008, 0x0060, modality),
    patientNameBytes == null
      ? pn(0x0010, 0x0010, patientName)
      : pnRaw(0x0010, 0x0010, patientNameBytes),
    lo(0x0010, 0x0020, patientId),
    da(0x0010, 0x0030, '19700101'),
    cs(0x0010, 0x0040, 'O'),
    ds(0x0018, 0x0050, String(sliceThickness)),
    ...(spacingBetweenSlices == null
      ? []
      : [ds(0x0018, 0x0088, String(spacingBetweenSlices))]),
    ...(ultrasoundRegion == null
      ? []
      : [
          sequence(0x0018, 0x6011, [
            combine(
              us(0x0018, 0x6024, 3),
              us(0x0018, 0x6026, 3),
              fd(0x0018, 0x602c, ultrasoundRegion.physicalDeltaX),
              fd(0x0018, 0x602e, ultrasoundRegion.physicalDeltaY)
            ),
          ]),
        ]),
    ui(0x0020, 0x000d, studyUid),
    ui(0x0020, 0x000e, seriesUid),
    sh(0x0020, 0x0010, '1'),
    ...(seriesNumber === undefined
      ? []
      : [is(0x0020, 0x0011, String(seriesNumber))]),
    ...(acquisitionNumber == null
      ? []
      : [is(0x0020, 0x0012, String(acquisitionNumber))]),
    is(0x0020, 0x0013, String(instanceNumber)),
    ...(rootGeometry
      ? [
          ds(0x0020, 0x0032, imagePositionPatient?.join('\\') ?? ''),
          ds(0x0020, 0x0037, imageOrientationPatient.join('\\')),
        ]
      : []),
    us(0x0028, 0x0002, rgbPixels ? 3 : 1),
    cs(0x0028, 0x0004, rgbPixels ? 'RGB' : 'MONOCHROME2'),
    ...(rgbPixels ? [us(0x0028, 0x0006, 0)] : []),
    ...(framePixelValues
      ? [is(0x0028, 0x0008, String(framePixelValues.length))]
      : []),
    us(0x0028, 0x0010, rows),
    us(0x0028, 0x0011, cols),
    ...(rootGeometry ? [ds(0x0028, 0x0030, pixelSpacing.join('\\'))] : []),
    us(0x0028, 0x0100, bitsAllocated),
    us(0x0028, 0x0101, bitsStored),
    us(0x0028, 0x0102, highBit),
    us(0x0028, 0x0103, pixelRepresentation),
    ...(rescaleIntercept == null
      ? []
      : [ds(0x0028, 0x1052, String(rescaleIntercept))]),
    ...(rescaleSlope == null ? [] : [ds(0x0028, 0x1053, String(rescaleSlope))]),
    ...extraElements,
    rawElement(0x7fe0, 0x0010, bitsAllocated === 8 ? 'OB' : 'OW', pixels)
  );

  return part10File(
    sopClassUid,
    sopUid,
    implicitVr ? TS_IMPLICIT_VR_LE : TS_EXPLICIT_VR_LE,
    implicitVr ? toImplicitVr(explicitDataset) : explicitDataset
  );
}

/** The bytes a Part 10 file spends on its preamble and DICM prefix. */
const PART_10_HEADER_LENGTH = 132;

/** The same file with its preamble and prefix cut off: file meta comes first. */
export const stripPreamble = (bytes: Uint8Array) =>
  bytes.slice(PART_10_HEADER_LENGTH);

/** The same file as a bare data set: no preamble, prefix or file meta. */
export const stripFileMeta = (bytes: Uint8Array) => {
  const meta = stripPreamble(bytes);
  // (0002,0000) UL: tag, VR and a 16 bit length, then the group length.
  const bodyLength = new DataView(meta.buffer, meta.byteOffset).getUint32(
    8,
    true
  );
  return meta.slice(12 + bodyLength);
};

export type EncapsulatedFrames = {
  /** Each frame's fragments, in order. */
  frames: readonly (readonly Uint8Array[])[];
  /** Whether the Basic Offset Table lists where each frame starts. */
  offsetTable?: boolean;
};

/** An encapsulated Pixel Data value: offset table item, fragments, delimiter. */
export function encapsulatedPixelData({
  frames,
  offsetTable = false,
}: EncapsulatedFrames) {
  const items = frames.map((fragments) =>
    combine(...fragments.map(sequenceItem))
  );
  const starts = items.map((_, index) =>
    items.slice(0, index).reduce((offset, item) => offset + item.length, 0)
  );
  const table = offsetTable
    ? combine(...starts.map(writeLong))
    : new Uint8Array();
  return combine(sequenceItem(table), ...items, SEQUENCE_DELIMITER);
}

export type SyntheticCineOptions = {
  studyUid: string;
  seriesUid: string;
  sopUid: string;
  numberOfFrames?: number;
  rows?: number;
  cols?: number;
  pixelSpacing?: readonly [number, number];
  patientName?: string;
  patientId?: string;
  seriesNumber?: number;
  studyDate?: string;
  /** JPEG Baseline frames to encapsulate in place of native pixels. */
  encapsulated?: EncapsulatedFrames;
  /** Written just before Pixel Data. */
  extraElements?: readonly Uint8Array[];
};

export function buildSyntheticCineDicom(opts: SyntheticCineOptions) {
  const {
    studyUid,
    seriesUid,
    sopUid,
    numberOfFrames = 3,
    rows = 4,
    cols = 5,
    pixelSpacing = [1, 1],
    patientName = 'TEST',
    patientId = 'TEST001',
    seriesNumber = 1,
    studyDate = '20260101',
    encapsulated,
    extraElements = [],
  } = opts;
  const frames = encapsulated?.frames.length ?? numberOfFrames;

  const dataset = combine(
    ui(0x0008, 0x0016, SOP_CLASS_ULTRASOUND_MULTIFRAME),
    ui(0x0008, 0x0018, sopUid),
    da(0x0008, 0x0020, studyDate),
    da(0x0008, 0x0021, studyDate),
    cs(0x0008, 0x0060, 'US'),
    lo(0x0008, 0x103e, 'Synthetic cine'),
    pn(0x0010, 0x0010, patientName),
    lo(0x0010, 0x0020, patientId),
    da(0x0010, 0x0030, '19700101'),
    cs(0x0010, 0x0040, 'O'),
    ui(0x0020, 0x000d, studyUid),
    ui(0x0020, 0x000e, seriesUid),
    sh(0x0020, 0x0010, '1'),
    is(0x0020, 0x0011, String(seriesNumber)),
    us(0x0028, 0x0002, 1),
    cs(0x0028, 0x0004, 'MONOCHROME2'),
    is(0x0028, 0x0008, String(frames)),
    us(0x0028, 0x0010, rows),
    us(0x0028, 0x0011, cols),
    ds(0x0028, 0x0030, pixelSpacing.join('\\')),
    us(0x0028, 0x0100, 8),
    us(0x0028, 0x0101, 8),
    us(0x0028, 0x0102, 7),
    us(0x0028, 0x0103, 0),
    ...extraElements,
    encapsulated
      ? combine(
          elementHeader(0x7fe0, 0x0010, 'OB', UNDEFINED_LENGTH),
          encapsulatedPixelData(encapsulated)
        )
      : rawElement(
          0x7fe0,
          0x0010,
          'OB',
          Uint8Array.from(
            { length: numberOfFrames * rows * cols },
            (_, i) => i % 251
          )
        )
  );

  return part10File(
    SOP_CLASS_ULTRASOUND_MULTIFRAME,
    sopUid,
    encapsulated ? TS_JPEG_BASELINE : TS_EXPLICIT_VR_LE,
    dataset
  );
}

// Pseudo-UID unique per call within a test process. All-numeric so it
// stays within DICOM UID character constraints.
let counter = 0;
export const newUid = () => {
  counter += 1;
  return `1.2.826.0.1.3680043.10.999.${process.pid}.${Date.now()}.${counter}`;
};
