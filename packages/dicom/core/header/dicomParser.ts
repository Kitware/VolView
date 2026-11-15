import StreamingByteReader from './streamingByteReader';
import { toAscii, asCoroutine } from '../utils';
import {
  DEFLATED_EXPLICIT_VR_LITTLE_ENDIAN,
  EXPLICIT_VR_BIG_ENDIAN,
  IMPLICIT_VR_LITTLE_ENDIAN,
  PART_10_HEADER_LENGTH,
  UNDEFINED_LENGTH,
  sniffDicomLayout,
  type DicomLayout,
} from '../metadata/dicomLayout';

// [Group, Element]
type Tag = [number, number];

export type DataElement = {
  group: number;
  element: number;
  vr: string;
  length: number;
  /** Absent for sequences and encapsulated values, which are only stepped over. */
  data: Uint8Array | undefined;
};

type DataElementCallback = (el: DataElement) => void;

type ParseOptions = {
  littleEndian?: boolean;
  explicitVr?: boolean;
  onDataElement?: DataElementCallback;
};

// This is based on the DICOM standard as of 2023. All links may point to whatever is the current at the time of visiting.

const isEncapsulatedValue = (vr: string, length: number) =>
  length === UNDEFINED_LENGTH && (vr === 'OB' || vr === 'OW');

const Tags = {
  TransferSyntaxUID: [0x0002, 0x0010] as Tag,
  ItemDelimiter: [0xfffe, 0xe00d] as Tag,
  Item: [0xfffe, 0xe000] as Tag,
};

// VR reference: https://dicom.nema.org/medical/dicom/current/output/chtml/part05/sect_6.2.html
// See: https://dicom.nema.org/medical/dicom/current/output/chtml/part05/chapter_7.html#sect_7.1.2
// prettier-ignore
const ExplicitVrLegacyDataElementFormat = new Set(["AE", "AS", "AT", "CS", "DA", "DS", "DT", "FL", "FD", "IS", "LO", "LT", "PN", "SH", "SL", "SS", "ST", "TM", "UI", "UL", "US"]);
// prettier-ignore
const ExplicitVrCannotHaveUndefinedLength = new Set(["SV", "UC", "UR", "UV", "UT"]);

function equalsToTag(tag: Tag) {
  return (group: number, element: number) =>
    group === tag[0] && element === tag[1];
}

function* readElementTag(
  reader: StreamingByteReader,
  { littleEndian = false } = {}
) {
  const group = yield* reader.readUint16({ littleEndian });
  const element = yield* reader.readUint16({ littleEndian });
  return [group, element] as Tag;
}

/**
 * Peeks the data element group num and element num
 *
 * Assumes the reader is pointing to the start of a Data Element.
 */
function* peekElementTag(
  reader: StreamingByteReader,
  { littleEndian = false } = {}
) {
  const bytes = yield* reader.read(4, { peek: true });
  let group = 0;
  let element = 0;

  if (littleEndian) {
    group = bytes[0] | (bytes[1] << 8);
    element = bytes[2] | (bytes[3] << 8);
  } else {
    group = bytes[1] | (bytes[0] << 8);
    element = bytes[3] | (bytes[2] << 8);
  }

  return [group, element] as Tag;
}

/**
 * Reads an element value.
 *
 * Assumes the reader is pointing to the first byte of an element's value.
 *
 * Returns no data for sequences and encapsulated values, but the reader pointer is advanced.
 */
function* readElementValue(
  reader: StreamingByteReader,
  vr: string,
  length: number,
  { explicitVr = false, littleEndian = false }: ParseOptions = {}
): Generator<Uint8Array | undefined, DataElement['data'], Uint8Array> {
  // See examples: https://dicom.nema.org/medical/dicom/current/output/chtml/part05/sect_7.5.2.html
  // PS3.5 6.2.2: an undefined-length UN holds sequence items encoded
  // in Implicit VR Little Endian, regardless of the enclosing syntax.
  if (vr === 'UN' && length === UNDEFINED_LENGTH) {
    yield* skipSequenceValue(reader, length, {
      explicitVr: false,
      littleEndian: true,
    });
    return undefined;
  }

  if (vr === 'SQ') {
    yield* skipSequenceValue(reader, length, { explicitVr, littleEndian });
    return undefined;
  }

  if (isEncapsulatedValue(vr, length)) {
    yield* readFragments(reader, { littleEndian });
    return undefined;
  }

  if (length === UNDEFINED_LENGTH)
    throw new Error('cannot read a value of undefined length');
  return yield* reader.read(length);
}

/** Fragment lengths bound opaque pixels, which can contain delimiter bytes. */
function* readFragments(reader: StreamingByteReader, opts: ParseOptions) {
  for (;;) {
    const [group, element] = yield* readElementTag(reader, opts);
    const length = yield* reader.readUint32(opts);
    if (group === 0xfffe && element === 0xe0dd && length === 0) return;
    if (!equalsToTag(Tags.Item)(group, element) || length === UNDEFINED_LENGTH)
      throw new Error('Expected a defined-length encapsulated fragment');
    yield* reader.seek(length);
  }
}

/**
 * Reads the data element at point.
 *
 * Does not parse the value according to VR or transfer syntax.
 *
 * Assumes the reader is pointing to the start of a Data Element.
 * https://dicom.nema.org/medical/dicom/current/output/chtml/part05/chapter_7.html#sect_7.1.1
 */
function* readDataElement(
  reader: StreamingByteReader,
  opts: ParseOptions = {}
) {
  const { littleEndian = false, explicitVr = false } = opts;
  // read tag
  const [group, element] = yield* readElementTag(reader, { littleEndian });
  let length = 0;
  let vr: string = '';
  let data: DataElement['data'];

  if (explicitVr) {
    // read VR
    vr = yield* reader.readAscii(2);
    if (ExplicitVrLegacyDataElementFormat.has(vr)) {
      length = yield* reader.readUint16({ littleEndian });
    } else {
      // skip reserved bytes
      yield* reader.seek(2);
      length = yield* reader.readUint32({ littleEndian });
    }

    if (
      length === UNDEFINED_LENGTH &&
      ExplicitVrCannotHaveUndefinedLength.has(vr)
    ) {
      console.warn(`Invalid DICOM. VR ${vr} may not have undefined length`);
    }

    data = yield* readElementValue(reader, vr, length, {
      littleEndian,
      explicitVr,
    });
  } else {
    length = yield* reader.readUint32({ littleEndian });

    // For implicit VR with undefined length, assume it's a sequence
    if (length === UNDEFINED_LENGTH) {
      vr = 'SQ';
    }

    data = yield* readElementValue(reader, vr, length, {
      littleEndian,
      explicitVr,
    });
  }

  return { group, element, vr, length, data };
}

/**
 * Stops the reader at the beginning of the data element that satisfies untilFn.
 *
 * Assumes the reader is pointing to the start of a Data Element.
 *
 * untilFn is passed (group, element)
 */
function* readDataElementsUntil(
  reader: StreamingByteReader,
  untilFn: (group: number, element: number) => boolean,
  opts: ParseOptions
) {
  while (true) {
    const [group, element] = yield* peekElementTag(reader, opts);
    if (untilFn(group, element)) {
      return;
    }
    const el = yield* readDataElement(reader, opts);
    opts.onDataElement?.(el);
  }
}

function* skipSequenceItem(reader: StreamingByteReader, opts: ParseOptions) {
  const itemByteLength = yield* reader.readUint32(opts);
  if (itemByteLength !== UNDEFINED_LENGTH) {
    yield* reader.seek(itemByteLength);
    return;
  }
  yield* readDataElementsUntil(reader, equalsToTag(Tags.ItemDelimiter), {
    ...opts,
    onDataElement: undefined,
  });
  yield* reader.seek(8);
}

/**
 * Steps over a sequence value. A defined length says where the value or item
 * ends, so only undefined lengths are walked, to find their delimiters.
 *
 * The reader must be pointing to the start of the sequence's data, namely the first item or the sequence delimitation item.
 *
 * See: https://dicom.nema.org/medical/dicom/current/output/chtml/part05/sect_7.5.html
 * and: https://dicom.nema.org/medical/dicom/current/output/chtml/part05/sect_7.5.2.html
 */
function* skipSequenceValue(
  reader: StreamingByteReader,
  byteLength: number,
  opts: ParseOptions
) {
  if (byteLength !== UNDEFINED_LENGTH) {
    yield* reader.seek(byteLength);
    return;
  }
  for (;;) {
    const [group, element] = yield* readElementTag(reader, opts);
    if (equalsToTag(Tags.Item)(group, element)) {
      yield* skipSequenceItem(reader, opts);
    } else if (group === 0xfffe && element === 0xe0dd) {
      yield* reader.seek(4);
      return;
    } else {
      throw new Error(
        `Expected a sequence item, found (${group.toString(
          16
        )},${element.toString(16)})`
      );
    }
  }
}

// Per Part 10: "File Meta Information shall be encoded using the Explicit VR Little Endian Transfer Syntax"
function* readFileMetaInfo(
  reader: StreamingByteReader,
  opts?: { onDataElement?: DataElementCallback }
) {
  // read up until the Transfer Syntax UID
  yield* readDataElementsUntil(reader, equalsToTag(Tags.TransferSyntaxUID), {
    explicitVr: true,
    littleEndian: true,
    onDataElement: opts?.onDataElement,
  });

  const transferSyntaxUidElement = yield* readDataElement(reader, {
    explicitVr: true,
    littleEndian: true,
  });
  opts?.onDataElement?.(transferSyntaxUidElement);

  if (transferSyntaxUidElement.vr !== 'UI')
    throw new Error('Transfer syntax UID element does not have a VR of UI');
  if (!transferSyntaxUidElement.data)
    throw new Error('Did not get data for the transfer syntax UID element');

  const transferSyntaxUid = toAscii(
    transferSyntaxUidElement.data as Uint8Array,
    {
      ignoreNulls: true,
    }
  );

  // Compressed bytes can resemble meta elements. The complete reader will
  // locate the end of group 2 and inflate the dataset before walking it.
  if (transferSyntaxUid === DEFLATED_EXPLICIT_VR_LITTLE_ENDIAN)
    return { transferSyntaxUid };

  // read until end of file meta info group block, which is the first non 0x0002 grouped element.
  // "Values of all Tags (0002,xxxx) are reserved for use by this Standard and later versions of DICOM."
  // https://dicom.nema.org/medical/dicom/current/output/html/part10.html#table_7.1-1
  yield* readDataElementsUntil(reader, (group) => group !== 0x0002, {
    explicitVr: true,
    littleEndian: true,
    onDataElement: opts?.onDataElement,
  });

  return {
    transferSyntaxUid,
  };
}

type ReadDicomOptions = {
  stopAtElement?(group: number, element: number): boolean;
  onDataElement?: DataElementCallback;
  /** Called once the opening bytes say how the file is laid out. */
  onLayout?(layout: DicomLayout): void;
  /** Called once the file meta information or the layout names the syntax. */
  onTransferSyntax?(transferSyntaxUid: string): void;
};

function* readDicomUntilPixelData(opts?: ReadDicomOptions) {
  const reader = new StreamingByteReader();

  // Peeked rather than read: a file without the Part 10 preamble has its
  // first element at byte 0.
  const head = yield* reader.read(PART_10_HEADER_LENGTH, { peek: true });
  const layout = sniffDicomLayout(head);
  opts?.onLayout?.(layout);
  if (layout.preamble) yield* reader.seek(PART_10_HEADER_LENGTH);

  const transferSyntaxUid = layout.fileMeta
    ? (yield* readFileMetaInfo(reader, {
        onDataElement: opts?.onDataElement,
      })).transferSyntaxUid
    : layout.transferSyntaxUid;
  opts?.onTransferSyntax?.(transferSyntaxUid);
  // A negative boundary asks the metadata loader to retain the complete file.
  if (transferSyntaxUid === DEFLATED_EXPLICIT_VR_LITTLE_ENDIAN)
    return { position: -1 };
  const explicitVr = transferSyntaxUid !== IMPLICIT_VR_LITTLE_ENDIAN;
  const littleEndian = transferSyntaxUid !== EXPLICIT_VR_BIG_ENDIAN;

  yield* readDataElementsUntil(
    reader,
    (group, element) => opts?.stopAtElement?.(group, element) ?? false,
    { explicitVr, littleEndian, onDataElement: opts?.onDataElement }
  );

  return { position: reader.position };
}

export const createDicomParser = (callbacks?: ReadDicomOptions) => {
  return asCoroutine(readDicomUntilPixelData(callbacks));
};
