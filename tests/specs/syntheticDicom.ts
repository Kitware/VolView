// Minimal synthetic DICOM (Explicit VR Little Endian) for tests.
// Emits just enough tags for ITK/GDCM to categorize and load a series:
// SOP Class/Instance UIDs, Study/SeriesInstanceUID, SeriesNumber, Modality,
// Patient identifiers, ImageOrientationPatient, ImagePositionPatient,
// PixelSpacing, SliceThickness, image geometry, and zeroed PixelData.

const SOP_CLASS_MR = '1.2.840.10008.5.1.4.1.1.4';
const TS_EXPLICIT_VR_LE = '1.2.840.10008.1.2.1';

const enc = new TextEncoder();

const padUi = (s: string) => (s.length % 2 === 0 ? s : `${s}\0`);
const padText = (s: string) => (s.length % 2 === 0 ? s : `${s} `);

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

const tagBytes = (group: number, element: number) => {
  const b = new Uint8Array(4);
  const dv = new DataView(b.buffer);
  dv.setUint16(0, group, true);
  dv.setUint16(2, element, true);
  return b;
};

const combine = (...arr: Uint8Array[]) => {
  const total = arr.reduce((acc, a) => acc + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arr) {
    out.set(a, off);
    off += a.length;
  }
  return out;
};

// Short-form explicit VR (2-byte length): UI, CS, DA, DS, IS, LO, PN, SH, US, UL, ...
const elemShort = (
  group: number,
  element: number,
  vr: string,
  value: Uint8Array
) =>
  combine(
    tagBytes(group, element),
    enc.encode(vr),
    writeShort(value.length),
    value
  );

// Long-form explicit VR (2-byte reserved + 4-byte length): OB, OW, UN, SQ, ...
const elemLong = (
  group: number,
  element: number,
  vr: string,
  value: Uint8Array
) =>
  combine(
    tagBytes(group, element),
    enc.encode(vr),
    new Uint8Array(2),
    writeLong(value.length),
    value
  );

const ui = (g: number, e: number, v: string) =>
  elemShort(g, e, 'UI', enc.encode(padUi(v)));
const cs = (g: number, e: number, v: string) =>
  elemShort(g, e, 'CS', enc.encode(padText(v)));
const pn = (g: number, e: number, v: string) =>
  elemShort(g, e, 'PN', enc.encode(padText(v)));
const lo = (g: number, e: number, v: string) =>
  elemShort(g, e, 'LO', enc.encode(padText(v)));
const sh = (g: number, e: number, v: string) =>
  elemShort(g, e, 'SH', enc.encode(padText(v)));
const da = (g: number, e: number, v: string) =>
  elemShort(g, e, 'DA', enc.encode(padText(v)));
const is = (g: number, e: number, v: string) =>
  elemShort(g, e, 'IS', enc.encode(padText(v)));
const ds = (g: number, e: number, v: string) =>
  elemShort(g, e, 'DS', enc.encode(padText(v)));
const us = (g: number, e: number, v: number) =>
  elemShort(g, e, 'US', writeShort(v));

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
  imagePositionPatient: readonly [number, number, number];
  rows?: number;
  cols?: number;
  pixelSpacing?: readonly [number, number];
  spacingBetweenSlices?: number;
  sliceThickness?: number;
  modality?: string;
  patientName?: string;
  patientId?: string;
  seriesNumber?: number;
  studyDate?: string;
};

export function buildSyntheticDicom(opts: SyntheticSliceOptions): Uint8Array {
  const {
    studyUid,
    seriesUid,
    sopUid,
    instanceNumber,
    imageOrientationPatient,
    imagePositionPatient,
    rows = 4,
    cols = 4,
    pixelSpacing = [1, 1] as const,
    spacingBetweenSlices,
    sliceThickness = 1,
    modality = 'MR',
    patientName = 'TEST',
    patientId = 'TEST001',
    seriesNumber = 1,
    studyDate = '20260101',
  } = opts;

  const dataset = combine(
    ui(0x0008, 0x0016, SOP_CLASS_MR),
    ui(0x0008, 0x0018, sopUid),
    da(0x0008, 0x0020, studyDate),
    da(0x0008, 0x0021, studyDate),
    cs(0x0008, 0x0060, modality),
    pn(0x0010, 0x0010, patientName),
    lo(0x0010, 0x0020, patientId),
    da(0x0010, 0x0030, '19700101'),
    cs(0x0010, 0x0040, 'O'),
    ds(0x0018, 0x0050, String(sliceThickness)),
    ...(spacingBetweenSlices == null
      ? []
      : [ds(0x0018, 0x0088, String(spacingBetweenSlices))]),
    ui(0x0020, 0x000d, studyUid),
    ui(0x0020, 0x000e, seriesUid),
    sh(0x0020, 0x0010, '1'),
    is(0x0020, 0x0011, String(seriesNumber)),
    is(0x0020, 0x0013, String(instanceNumber)),
    ds(
      0x0020,
      0x0032,
      imagePositionPatient.map((n) => n.toString()).join('\\')
    ),
    ds(
      0x0020,
      0x0037,
      imageOrientationPatient.map((n) => n.toString()).join('\\')
    ),
    us(0x0028, 0x0002, 1),
    cs(0x0028, 0x0004, 'MONOCHROME2'),
    us(0x0028, 0x0010, rows),
    us(0x0028, 0x0011, cols),
    ds(0x0028, 0x0030, pixelSpacing.map((n) => n.toString()).join('\\')),
    us(0x0028, 0x0100, 16),
    us(0x0028, 0x0101, 16),
    us(0x0028, 0x0102, 15),
    us(0x0028, 0x0103, 0),
    elemLong(0x7fe0, 0x0010, 'OW', new Uint8Array(rows * cols * 2))
  );

  const fileMetaBody = combine(
    elemLong(0x0002, 0x0001, 'OB', new Uint8Array([0x00, 0x01])),
    ui(0x0002, 0x0002, SOP_CLASS_MR),
    ui(0x0002, 0x0003, sopUid),
    ui(0x0002, 0x0010, TS_EXPLICIT_VR_LE)
  );
  const fileMeta = combine(
    elemShort(0x0002, 0x0000, 'UL', writeLong(fileMetaBody.length)),
    fileMetaBody
  );

  return combine(new Uint8Array(128), enc.encode('DICM'), fileMeta, dataset);
}

// Pseudo-UID unique per call within a test process. All-numeric so it
// stays within DICOM UID character constraints.
let counter = 0;
export const newUid = () => {
  counter += 1;
  return `1.2.826.0.1.3680043.10.999.${process.pid}.${Date.now()}.${counter}`;
};
