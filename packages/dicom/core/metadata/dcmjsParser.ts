import dcmjs, { DicomElement, DicomReadStream } from 'dcmjs';
import {
  EXPLICIT_VR_LITTLE_ENDIAN,
  IMPLICIT_VR_LITTLE_ENDIAN,
  PART_10_HEADER_LENGTH,
  sniffDicomLayout,
} from './dicomLayout';

const { encodingMapping } = dcmjs.constants;
const {
  DicomMessage,
  DicomMetaDictionary,
  ReadBufferStream,
  DeflatedReadBufferStream,
} = dcmjs.data;

const FILE_META_GROUP = 0x0002;
const FILE_META_GROUP_LENGTH = '00020000';
const TRANSFER_SYNTAX_UID = '00020010';
const PIXEL_DATA = '7FE00010';
const EXPLICIT_VR_BIG_ENDIAN = '1.2.840.10008.1.2.2';
const DEFLATED_EXPLICIT_VR_LITTLE_ENDIAN = '1.2.840.10008.1.2.1.99';
const RESERVED_LENGTH = 2;
const UNDEFINED_LENGTH = 0xffffffff;

/** VRs whose explicit form carries two reserved bytes and a 32 bit length. */
const LENGTH_32_VRS = new Set([
  'OB',
  'OD',
  'OF',
  'OL',
  'OV',
  'OW',
  'SQ',
  'SV',
  'UC',
  'UN',
  'UR',
  'UT',
]);

/** Bound on one `String.fromCharCode` spread, which is an argument list. */
const SPREAD_LIMIT = 4096;

/** A byte string holds one code unit per byte, which `toBytes` reverses. */
export const binaryString = (bytes: Uint8Array) => {
  let text = '';
  for (let i = 0; i < bytes.length; i += SPREAD_LIMIT)
    text += String.fromCharCode(...bytes.subarray(i, i + SPREAD_LIMIT));
  return text;
};

export const toBytes = (raw: string) =>
  Uint8Array.from(raw, (char) => char.charCodeAt(0) & 0xff);

/** DICOM character set name to `TextDecoder` label, as dcmjs tabulates it. */
export const encodingLabel = (name: string) =>
  encodingMapping[name.trim().replace(/[_ ]/g, '-').toLowerCase()];

/**
 * One value as the file wrote it. A text VR is a byte string, so the Specific
 * Character Set can be applied once the whole data set is known.
 */
export type ParsedValue = string | number | Uint8Array;

/** One element, with no dcmjs object left in it. */
export type ParsedElement = {
  group: number;
  element: number;
  vr: string;
  values: ParsedValue[];
  /** Items of a sequence, each a list of elements. */
  items?: ParsedElement[][];
  /** Set when the element's header was read but its value was not. */
  unread?: { bytes: Uint8Array; reason: string };
};

/**
 * Keeps one code unit per byte so the Specific Character Set can be applied
 * once the whole data set is read. dcmjs otherwise picks a single decoder from
 * character set value 1, which is the default repertoire rather than the
 * extension that covers the non-ASCII characters.
 */
const byteDecoder = {
  decode: (view: ArrayBufferView) =>
    binaryString(new Uint8Array(view.buffer, view.byteOffset, view.byteLength)),
};

/**
 * Bounded item streams must keep their bytes until the enclosing dataset's
 * Specific Character Set is known, including an item's inherited repertoire.
 */
const readsBytes = (stream: DicomReadStream) => {
  stream.setDecoder(byteDecoder);
  const derive = stream.more.bind(stream);
  stream.more = (length: number) => readsBytes(derive(length));
  return stream;
};

const viewBytes = (value: unknown) => {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value))
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return null;
};

/** A group or element number as four upper case hexadecimal digits. */
export const hex4 = (value: number) =>
  value.toString(16).padStart(4, '0').toUpperCase();

const dictionaryVr = (group: number, element: number) =>
  DicomMetaDictionary.dictionary[`(${hex4(group)},${hex4(element)})`]?.vr;

/** dcmjs reads from an ArrayBuffer, which a whole-buffer view already is. */
const bufferOf = (bytes: Uint8Array) =>
  bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? (bytes.buffer as ArrayBuffer)
    : (bytes.slice().buffer as ArrayBuffer);

/**
 * Opens the data set. A file without the Part 10 preamble is read from its
 * first element; one without file meta information is read in the transfer
 * syntax its first element suggests.
 */
const pastDeflatedMeta = (syntax: unknown, offset: number, end: number) =>
  syntax === DEFLATED_EXPLICIT_VR_LITTLE_ENDIAN && offset >= end;

const openFile = (bytes: Uint8Array) => {
  const layout = sniffDicomLayout(bytes.subarray(0, PART_10_HEADER_LENGTH));

  const stream = new ReadBufferStream(bufferOf(bytes));
  stream.reset();
  if (layout.preamble) stream.increment(PART_10_HEADER_LENGTH);
  if (!layout.fileMeta)
    return {
      dataSet: readsBytes(stream),
      syntax: DicomMessage._normalizeSyntax(layout.transferSyntaxUid),
    };

  // Read group 2 sequentially when its group length is absent. A declared
  // length also prevents compressed data from being mistaken for more meta.
  let syntax: unknown;
  let metaEnd = bytes.length;
  stream.setEndian(true);
  while (!stream.end() && !pastDeflatedMeta(syntax, stream.offset, metaEnd)) {
    const start = stream.offset;
    const group = stream.readUint16();
    stream.offset = start;
    if (group !== FILE_META_GROUP) break;
    const attribute = DicomMessage._readTag(stream, EXPLICIT_VR_LITTLE_ENDIAN);
    const tag = attribute.tag.toCleanString();
    if (tag === FILE_META_GROUP_LENGTH) {
      const [length] = attribute.values as number[];
      metaEnd = stream.offset + length;
    }
    if (tag === TRANSFER_SYNTAX_UID) [syntax] = attribute.values as unknown[];
  }
  if (typeof syntax !== 'string')
    throw new Error('Not a DICOM file: the transfer syntax is missing');

  const dataSet =
    syntax === DEFLATED_EXPLICIT_VR_LITTLE_ENDIAN
      ? new DeflatedReadBufferStream(stream)
      : stream;
  return {
    dataSet: readsBytes(dataSet),
    syntax: DicomMessage._normalizeSyntax(syntax),
  };
};

const needsSequenceReader = (vr: string | undefined, length: number) =>
  vr === 'SQ' || (vr === 'UN' && length === UNDEFINED_LENGTH);

/**
 * A known UN retains its implicit encoding even inside an explicit dataset.
 */
const isKnownUnknown = (
  vr: string | undefined,
  group: number,
  element: number
) => {
  if (vr !== 'UN') return false;
  const known = dictionaryVr(group, element);
  return known !== undefined && known !== 'UN';
};

const peekSequence = (dataSet: DicomReadStream, syntax: string) => {
  const start = dataSet.offset;
  const implicit = syntax === IMPLICIT_VR_LITTLE_ENDIAN;
  dataSet.setEndian(syntax !== EXPLICIT_VR_BIG_ENDIAN);
  const group = dataSet.readUint16();
  const element = dataSet.readUint16();
  const vr = implicit ? dictionaryVr(group, element) : dataSet.readVR();
  const length32 = implicit || LENGTH_32_VRS.has(vr ?? '');
  if (length32 && !implicit) dataSet.increment(RESERVED_LENGTH);
  const length = length32 ? dataSet.readUint32() : dataSet.readUint16();
  const valueStart = dataSet.offset;
  dataSet.offset = start;
  const knownUnknown = isKnownUnknown(vr, group, element);
  return needsSequenceReader(vr, length) || knownUnknown
    ? {
        unknown: vr === 'UN',
        group,
        element,
        valueStart,
        end: length === UNDEFINED_LENGTH ? null : valueStart + length,
      }
    : null;
};

/**
 * dcmjs drops the trailing byte that padded a value to an even length, which
 * the file wrote. A UI's pad is a null byte and carries no value, so only the
 * space that pads a text VR is put back.
 */
const restorePadByte = (vr: string, values: string[]) => {
  const byteLength = values.reduce(
    (total, value) => total + value.length,
    values.length - 1
  );
  return vr !== 'UI' && byteLength % 2 === 1
    ? values.map((value, index) =>
        index === values.length - 1 ? `${value} ` : value
      )
    : values;
};

const rawValuesOf = (rawValues: unknown) => {
  if (rawValues == null) return [];
  return Array.isArray(rawValues) ? (rawValues as unknown[]) : [rawValues];
};

const parsedValues = (vr: string, rawValues: unknown): ParsedValue[] => {
  const values = rawValuesOf(rawValues);
  if (values.every((value): value is string => typeof value === 'string'))
    return restorePadByte(vr, values);
  return values.map((value) => {
    const bytes = viewBytes(value);
    if (bytes) return bytes;
    return typeof value === 'number' ? value : String(value);
  });
};

const groupOf = (tag: string) => Number.parseInt(tag.slice(0, 4), 16);
const elementOf = (tag: string) => Number.parseInt(tag.slice(4), 16);

const parsedElement = (element: DicomElement): ParsedElement => {
  const tag = element.tag.toCleanString();
  const vr = element.vr === 0 ? '' : element.vr.type;
  return {
    group: groupOf(tag),
    element: elementOf(tag),
    vr,
    values: parsedValues(vr, element.rawValues),
  };
};

const READ_OPTIONS = {
  untilTag: PIXEL_DATA,
  includeUntilTagValue: false,
  forceStoreRaw: true,
};

const readSequence = (
  dataSet: DicomReadStream,
  syntax: string,
  sequence: {
    group: number;
    element: number;
    valueStart: number;
    end: number | null;
    unknown?: boolean;
  }
): ParsedElement => {
  if (sequence.unknown && sequence.end !== null) {
    // PS3.5 6.2.2: a known UN value retains Implicit VR Little Endian encoding.
    const value = new Uint8Array(
      dataSet.slice(sequence.valueStart, sequence.end)
    );
    const bytes = new Uint8Array(8 + value.length);
    const header = new DataView(bytes.buffer);
    header.setUint16(0, sequence.group, true);
    header.setUint16(2, sequence.element, true);
    header.setUint32(4, value.length, true);
    bytes.set(value, 8);
    dataSet.offset = sequence.end;
    return readElements(
      readsBytes(new ReadBufferStream(bytes.buffer)),
      IMPLICIT_VR_LITTLE_ENDIAN,
      { stopAtPixelData: false }
    )[0];
  }

  const itemSyntax = sequence.unknown ? IMPLICIT_VR_LITTLE_ENDIAN : syntax;
  dataSet.offset = sequence.valueStart;
  try {
    const items = readSequenceItems(dataSet, itemSyntax, sequence.end);
    return {
      group: sequence.group,
      element: sequence.element,
      vr: sequence.unknown ? 'UN' : 'SQ',
      values: [],
      items,
    };
  } catch (error) {
    if (sequence.end === null) throw error;
    const bytes = new Uint8Array(
      dataSet.slice(sequence.valueStart, sequence.end)
    );
    dataSet.offset = sequence.end;
    return {
      group: sequence.group,
      element: sequence.element,
      vr: sequence.unknown ? 'UN' : 'SQ',
      values: [],
      unread: { bytes, reason: String(error) },
    };
  }
};

const assertSequenceBounds = (
  offset: number,
  end: number | null,
  length = 0
) => {
  if (end !== null && offset + length > end)
    throw new Error('Sequence item exceeds the declared sequence length');
};

function readSequenceItemLength(dataSet: DicomReadStream, syntax: string) {
  dataSet.setEndian(syntax !== EXPLICIT_VR_BIG_ENDIAN);
  const group = dataSet.readUint16();
  const element = dataSet.readUint16();
  const length = dataSet.readUint32();
  if (group === 0xfffe && element === 0xe0dd && length === 0) return null;
  if (group !== 0xfffe || element !== 0xe000)
    throw new Error('Expected a sequence item');
  return length;
}

function readSequenceItems(
  dataSet: DicomReadStream,
  syntax: string,
  end: number | null
) {
  const items: ParsedElement[][] = [];
  while (end === null || dataSet.offset < end) {
    const length = readSequenceItemLength(dataSet, syntax);
    if (length === null) return items;
    assertSequenceBounds(
      dataSet.offset,
      end,
      length === UNDEFINED_LENGTH ? 0 : length
    );
    items.push(
      length === UNDEFINED_LENGTH
        ? readElements(dataSet, syntax, {
            untilItemDelimiter: true,
            stopAtPixelData: false,
          })
        : readElements(dataSet.more(length), syntax, { stopAtPixelData: false })
    );
    assertSequenceBounds(dataSet.offset, end);
  }
  return items;
}

/** Consumes an item delimiter, leaving any other element unread. */
const readItemDelimiter = (dataSet: DicomReadStream) => {
  const start = dataSet.offset;
  dataSet.setEndian(true);
  const group = dataSet.readUint16();
  const element = dataSet.readUint16();
  if (group !== 0xfffe || element !== 0xe00d) {
    dataSet.offset = start;
    return false;
  }
  if (dataSet.readUint32() !== 0)
    throw new Error('Invalid item delimiter length');
  return true;
};

const readNextElement = (
  dataSet: DicomReadStream,
  syntax: string,
  stopAtPixelData: boolean
) => {
  const sequence = peekSequence(dataSet, syntax);
  if (
    sequence &&
    stopAtPixelData &&
    sequence.group === 0x7fe0 &&
    sequence.element === 0x0010
  )
    return { element: null, done: true };
  if (sequence)
    return { element: readSequence(dataSet, syntax, sequence), done: false };

  const element = DicomMessage._readTag(
    dataSet,
    syntax,
    stopAtPixelData ? READ_OPTIONS : { forceStoreRaw: true }
  );
  const done = stopAtPixelData && element.tag.toCleanString() === PIXEL_DATA;
  return {
    element: done || element.vr === 0 ? null : parsedElement(element),
    done,
  };
};

const readElements = (
  dataSet: DicomReadStream,
  syntax: string,
  { untilItemDelimiter = false, stopAtPixelData = true } = {}
): ParsedElement[] => {
  const elements: ParsedElement[] = [];
  let done = false;
  while (!done && !dataSet.end()) {
    if (untilItemDelimiter && readItemDelimiter(dataSet)) return elements;
    const next = readNextElement(dataSet, syntax, stopAtPixelData);
    done = next.done;
    if (next.element) elements.push(next.element);
  }
  if (untilItemDelimiter)
    throw new Error('Missing item delimiter in undefined-length UN');
  return elements;
};

/** Reads a Part 10 file's data set elements, stopping before Pixel Data. */
export const parseDicomElements = (bytes: Uint8Array) => {
  const { dataSet, syntax } = openFile(bytes);
  return readElements(dataSet, syntax);
};
