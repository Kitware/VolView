// Part 10 files with uncompressed Pixel Data in any native transfer syntax,
// for comparing frame decoders. Stored words are written as given, so high
// bits above Bits Stored can carry anything a test wants.

import { combine } from '@/tests/specs/syntheticDicom';

export const IMPLICIT_LE = '1.2.840.10008.1.2';
export const EXPLICIT_LE = '1.2.840.10008.1.2.1';
export const EXPLICIT_BE = '1.2.840.10008.1.2.2';

type Value =
  | string
  | readonly number[]
  | Uint8Array
  | ReadonlyArray<readonly DataElement[]>;
export type DataElement = { tag: number; vr: string; value: Value };

const LONG_FORM = new Set([
  'OB',
  'OD',
  'OF',
  'OL',
  'OV',
  'OW',
  'SQ',
  'UN',
  'UT',
]);
const NUMBER_WIDTH: Record<string, number> = {
  US: 2,
  SS: 2,
  UL: 4,
  SL: 4,
  FL: 4,
  FD: 8,
};

type Encoding = { explicit: boolean; littleEndian: boolean };

const uint = (value: number, width: number, littleEndian: boolean) => {
  const bytes = new Uint8Array(width);
  const view = new DataView(bytes.buffer);
  if (width === 2) view.setUint16(0, value, littleEndian);
  else view.setUint32(0, value, littleEndian);
  return bytes;
};

const numbers = (vr: string, values: number[], littleEndian: boolean) => {
  const width = NUMBER_WIDTH[vr];
  const bytes = new Uint8Array(width * values.length);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => {
    const at = index * width;
    if (vr === 'US') view.setUint16(at, value, littleEndian);
    else if (vr === 'SS') view.setInt16(at, value, littleEndian);
    else if (vr === 'UL') view.setUint32(at, value, littleEndian);
    else if (vr === 'SL') view.setInt32(at, value, littleEndian);
    else if (vr === 'FL') view.setFloat32(at, value, littleEndian);
    else view.setFloat64(at, value, littleEndian);
  });
  return bytes;
};

const tagBytes = (tag: number, littleEndian: boolean) =>
  combine(
    uint(tag >>> 16, 2, littleEndian),
    uint(tag & 0xffff, 2, littleEndian)
  );

function valueBytes(element: DataElement, encoding: Encoding): Uint8Array {
  const { vr, value } = element;
  if (typeof value === 'string') {
    const pad = vr === 'UI' ? '\0' : ' ';
    return new TextEncoder().encode(value.length % 2 ? value + pad : value);
  }
  if (value instanceof Uint8Array)
    return value.length % 2 ? combine(value, new Uint8Array(1)) : value;
  if (vr === 'SQ')
    return combine(
      ...(value as DataElement[][]).map((item) => {
        const body = encodeElements(item, encoding);
        return combine(
          tagBytes(0xfffee000, encoding.littleEndian),
          uint(body.length, 4, encoding.littleEndian),
          body
        );
      })
    );
  return numbers(vr, value as number[], encoding.littleEndian);
}

function encodeElement(element: DataElement, encoding: Encoding) {
  const { littleEndian } = encoding;
  const value = valueBytes(element, encoding);
  const head = encoding.explicit
    ? LONG_FORM.has(element.vr)
      ? [
          new TextEncoder().encode(element.vr),
          new Uint8Array(2),
          uint(value.length, 4, littleEndian),
        ]
      : [
          new TextEncoder().encode(element.vr),
          uint(value.length, 2, littleEndian),
        ]
    : [uint(value.length, 4, littleEndian)];
  return combine(tagBytes(element.tag, littleEndian), ...head, value);
}

const encodeElements = (elements: DataElement[], encoding: Encoding) =>
  combine(
    ...[...elements]
      .sort((a, b) => a.tag - b.tag)
      .map((element) => encodeElement(element, encoding))
  );

/** Wraps a data set in a preamble and Explicit VR Little Endian file meta. */
function part10(
  dataset: DataElement[],
  transferSyntaxUid: string,
  sopClassUid: string,
  sopInstanceUid: string
) {
  const meta = encodeElements(
    [
      { tag: 0x00020001, vr: 'OB', value: new Uint8Array([0, 1]) },
      { tag: 0x00020002, vr: 'UI', value: sopClassUid },
      { tag: 0x00020003, vr: 'UI', value: sopInstanceUid },
      { tag: 0x00020010, vr: 'UI', value: transferSyntaxUid },
    ],
    { explicit: true, littleEndian: true }
  );
  const groupLength = encodeElement(
    { tag: 0x00020000, vr: 'UL', value: [meta.length] },
    { explicit: true, littleEndian: true }
  );
  const encoding = {
    explicit: transferSyntaxUid !== IMPLICIT_LE,
    littleEndian: transferSyntaxUid !== EXPLICIT_BE,
  };
  return combine(
    new Uint8Array(128),
    new TextEncoder().encode('DICM'),
    groupLength,
    meta,
    encodeElements(dataset, encoding)
  );
}

export type NativePixelOptions = {
  transferSyntaxUid?: string;
  sopClassUid?: string;
  modality?: string;
  rows?: number;
  columns?: number;
  /** Written as Number of Frames when given. */
  frames?: number;
  samplesPerPixel?: number;
  photometric?: string;
  planarConfiguration?: number;
  bitsAllocated?: number;
  bitsStored?: number;
  highBit?: number;
  pixelRepresentation?: number;
  /** Stored words in file order, unsigned, frames one after another. */
  words?: ArrayLike<number>;
  rescale?: readonly [slope: number, intercept: number];
  /** One Pixel Value Transformation per frame, in Per-Frame Functional Groups. */
  frameRescales?: ReadonlyArray<readonly [slope: number, intercept: number]>;
  extra?: readonly DataElement[];
  /** Instance Number, which also seeds the default words and the SOP UID. */
  instance?: number;
  position?: readonly [number, number, number];
};

/** Every bit pattern a word can hold, spread deterministically over `count`. */
export function patternWords(count: number, bitsAllocated: number, seed = 1) {
  const span = 2 ** bitsAllocated;
  let state = seed >>> 0 || 1;
  return Array.from({ length: count }, (_, index) => {
    // Endpoints first, so the extremes of every width are always covered.
    if (index < 4) return [0, span - 1, span / 2, span / 2 - 1][index];
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return bitsAllocated === 32 ? state : state % span;
  });
}

const decimal = (value: number) => String(value);

const frameRescaleGroups = (
  rescales: ReadonlyArray<readonly [number, number]>
): DataElement => ({
  tag: 0x52009230,
  vr: 'SQ',
  value: rescales.map(([slope, intercept]) => [
    {
      tag: 0x00289145,
      vr: 'SQ',
      value: [
        [
          { tag: 0x00281052, vr: 'DS', value: decimal(intercept) },
          { tag: 0x00281053, vr: 'DS', value: decimal(slope) },
          { tag: 0x00281054, vr: 'LO', value: 'US' },
        ],
      ],
    },
  ]),
});

export function nativePixelDicom(options: NativePixelOptions = {}) {
  const {
    transferSyntaxUid = EXPLICIT_LE,
    sopClassUid = '1.2.840.10008.5.1.4.1.1.2',
    modality = 'CT',
    rows = 5,
    columns = 3,
    frames,
    samplesPerPixel = 1,
    photometric = samplesPerPixel === 3 ? 'RGB' : 'MONOCHROME2',
    planarConfiguration,
    bitsAllocated = 16,
    bitsStored = bitsAllocated,
    highBit = bitsStored - 1,
    pixelRepresentation = 0,
    rescale,
    frameRescales,
    extra = [],
    instance = 1,
    position = [0, 0, 0],
  } = options;
  const count = rows * columns * samplesPerPixel * (frames ?? 1);
  const words = options.words ?? patternWords(count, bitsAllocated, instance);
  if (words.length !== count)
    throw new Error(`Expected ${count} stored words, got ${words.length}`);
  const littleEndian = transferSyntaxUid !== EXPLICIT_BE;
  const width = bitsAllocated / 8;
  const pixels = new Uint8Array(count * width);
  const view = new DataView(pixels.buffer);
  Array.from(words).forEach((word, index) => {
    if (width === 1) pixels[index] = word;
    else if (width === 2) view.setUint16(index * 2, word, littleEndian);
    else view.setUint32(index * 4, word, littleEndian);
  });
  const sopInstanceUid = `1.2.826.0.1.3680043.10.997.${instance}`;
  const dataset: DataElement[] = [
    { tag: 0x00080016, vr: 'UI', value: sopClassUid },
    { tag: 0x00080018, vr: 'UI', value: sopInstanceUid },
    { tag: 0x00080060, vr: 'CS', value: modality },
    { tag: 0x00100010, vr: 'PN', value: 'NATIVE^PIXELS' },
    { tag: 0x0020000d, vr: 'UI', value: '1.2.826.0.1.3680043.10.997.1000' },
    { tag: 0x0020000e, vr: 'UI', value: '1.2.826.0.1.3680043.10.997.2000' },
    { tag: 0x00200013, vr: 'IS', value: String(instance) },
    { tag: 0x00200032, vr: 'DS', value: position.join('\\') },
    { tag: 0x00200037, vr: 'DS', value: '1\\0\\0\\0\\1\\0' },
    { tag: 0x00280002, vr: 'US', value: [samplesPerPixel] },
    { tag: 0x00280004, vr: 'CS', value: photometric },
    { tag: 0x00280010, vr: 'US', value: [rows] },
    { tag: 0x00280011, vr: 'US', value: [columns] },
    { tag: 0x00280030, vr: 'DS', value: '1\\1' },
    { tag: 0x00280100, vr: 'US', value: [bitsAllocated] },
    { tag: 0x00280101, vr: 'US', value: [bitsStored] },
    { tag: 0x00280102, vr: 'US', value: [highBit] },
    { tag: 0x00280103, vr: 'US', value: [pixelRepresentation] },
    { tag: 0x7fe00010, vr: bitsAllocated === 8 ? 'OB' : 'OW', value: pixels },
    ...extra,
  ];
  if (frames !== undefined)
    dataset.push({ tag: 0x00280008, vr: 'IS', value: String(frames) });
  if (planarConfiguration !== undefined)
    dataset.push({ tag: 0x00280006, vr: 'US', value: [planarConfiguration] });
  if (rescale)
    dataset.push(
      { tag: 0x00281052, vr: 'DS', value: decimal(rescale[1]) },
      { tag: 0x00281053, vr: 'DS', value: decimal(rescale[0]) }
    );
  if (frameRescales) dataset.push(frameRescaleGroups(frameRescales));
  return part10(dataset, transferSyntaxUid, sopClassUid, sopInstanceUid);
}
