/* eslint-disable no-use-before-define */
/* eslint-disable no-continue */
import StreamingByteReader from '@/src/core/streaming/streamingByteReader.js';
import { toAscii, asCoroutine } from '@/src/utils';

// [Group, Element]
type Tag = [number, number];

export type DataElement = {
  group: number;
  element: number;
  vr: string;
  length: number;
  data: Array<DataElement[]> | Uint8Array | undefined;
};

export type DataElementCallback = (el: DataElement) => void;
export type ElementTagCallback = (
  group: number,
  element: number
) => string | null;

interface ParseOptions {
  peek?: boolean;
  littleEndian?: boolean;
  explicitVr?: boolean;
  onDataElement?: DataElementCallback;
}

// This is based on the DICOM standard as of 2023. All links may point to whatever is the current at the time of visiting.

const UndefinedLength = 0xffffffff;
export const ImplicitTransferSyntaxUID = '1.2.840.10008.1.2';
export const ExplicitVRBigEndianUID = '1.2.840.10008.1.2.2';

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

const DEBUG = false;

function debug(...args: any[]) {
  if (DEBUG) console.log(...args);
}

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
 * @param {*} reader
 * @param {*} opts
 * @returns
 */
function* peekElementTag(
  reader: StreamingByteReader,
  { littleEndian = false } = {}
) {
  const bytes = yield* reader.read(4, { peek: true });
  let group = 0;
  let element = 0;
  /* eslint-disable no-bitwise */
  if (littleEndian) {
    group = bytes[0] | (bytes[1] << 8);
    element = bytes[2] | (bytes[3] << 8);
  } else {
    group = bytes[1] | (bytes[0] << 8);
    element = bytes[3] | (bytes[2] << 8);
  }
  /* eslint-enable no-bitwise */
  return [group, element] as Tag;
}

/**
 * Reads an element value.
 *
 * Assumes the reader is pointing to the first byte of an element's value.
 *
 * Does not return data for undefined lengths, but the reader pointer is advanced.
 * @returns
 */
function* readElementValue(
  reader: StreamingByteReader,
  vr: string,
  length: number,
  { explicitVr = false, littleEndian = false } = {}
): Generator<Uint8Array | undefined, DataElement['data'], Uint8Array> {
  // See examples: https://dicom.nema.org/medical/dicom/current/output/chtml/part05/sect_7.5.2.html
  if (vr === 'SQ') {
    return yield* readSequenceValue(reader, length, {
      explicitVr,
      littleEndian,
    });
  }

  if (length === UndefinedLength)
    throw new Error('cannot read a value of undefined length');
  return yield* reader.read(length);
}

/**
 * Reads the data element at point.
 *
 * Does not parse the value according to VR or transfer syntax.
 *
 * Does not return the element value if the length is undefined.
 *
 * Assumes the reader is pointing to the start of a Data Element.
 * https://dicom.nema.org/medical/dicom/current/output/chtml/part05/chapter_7.html#sect_7.1.1
 * @param {*} reader
 */
function* readDataElement(reader: StreamingByteReader, opts?: ParseOptions) {
  const { littleEndian = false, explicitVr = false } = opts ?? {};
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
      length === UndefinedLength &&
      ExplicitVrCannotHaveUndefinedLength.has(vr)
    ) {
      console.warn(`Invalid DICOM. VR ${vr} may not have undefined length`);
    }

    debug(
      'readDataElement explicitVr',
      group.toString(16),
      element.toString(16),
      'length',
      length
    );
    data = yield* readElementValue(reader, vr, length, {
      littleEndian,
      explicitVr,
    });
  } else {
    length = yield* reader.readUint32({ littleEndian });
    debug(
      'readDataElement implicitVr',
      group.toString(16),
      element.toString(16),
      'length',
      length
    );
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

/**
 * Stops the reader when the byte length is exhausted from the reader position.
 *
 * Assumes the reader is pointing to the start of a Data Element.
 */
function* readFiniteDataElements(
  reader: StreamingByteReader,
  byteLength: number,
  opts: ParseOptions
) {
  const endPosition = reader.position + byteLength;
  while (reader.position < endPosition) {
    const el = yield* readDataElement(reader, opts);
    opts.onDataElement?.(el);
  }
}

/**
 * The reader must be pointing to the start of the sequence's data, namely the first item or the sequence delimitation item.
 *
 * See: https://dicom.nema.org/medical/dicom/current/output/chtml/part05/sect_7.5.html
 * and: https://dicom.nema.org/medical/dicom/current/output/chtml/part05/sect_7.5.2.html
 */
function* readSequenceValue(
  reader: StreamingByteReader,
  byteLength: number,
  { explicitVr = false, littleEndian = false } = {}
) {
  const items = [] as Array<DataElement[]>;
  const isUndefinedLength = byteLength === UndefinedLength;
  const endPosition = isUndefinedLength ? 0 : reader.position + byteLength;
  while (true) {
    if (!isUndefinedLength && reader.position >= endPosition) {
      return items;
    }

    const [group, element] = yield* readElementTag(reader, { littleEndian });

    // Item tag
    // https://dicom.nema.org/medical/dicom/current/output/chtml/part05/sect_7.5.2.html#table_7.5-3
    if (equalsToTag(Tags.Item)(group, element)) {
      const itemDataset: DataElement[] = [];
      const itemByteLength = yield* reader.readUint32({ littleEndian });

      // length rules: https://dicom.nema.org/medical/dicom/current/output/chtml/part05/sect_7.5.html, heading 7.5.1
      if (itemByteLength !== UndefinedLength) {
        yield* readFiniteDataElements(reader, itemByteLength, {
          explicitVr,
          littleEndian,
          onDataElement(el) {
            itemDataset.push(el);
          },
        });
      } else {
        // read until item delimitation tag
        yield* readDataElementsUntil(reader, equalsToTag(Tags.ItemDelimiter), {
          explicitVr,
          littleEndian,
          onDataElement(el) {
            itemDataset.push(el);
          },
        });
        // skip the item delimitation tag and the 4-byte zero length
        yield* reader.seek(4 + 4);
      }

      items.push(itemDataset);
      continue;
    }

    // Sequence Delimitation Item tag
    // "Otherwise, the Value Field has an Undefined Length and a Sequence Delimitation Item marks the end of the Value Field."
    // https://dicom.nema.org/medical/dicom/current/output/chtml/part05/chapter_7.html#sect_7.1.2
    if (isUndefinedLength && group === 0xfffe && element === 0xe0dd) {
      // skip the 4-byte zero length
      yield* reader.seek(4);
      return items;
    }

    throw new Error(
      `readSequenceValue: encountered unknown element: (${group.toString(
        16
      )},${element.toString(16)})`
    );
  }
}

// Per Part 10: "File Meta Information shall be encoded using the Explicit VR Little Endian Transfer Syntax"
// Transfer syntaxes are negotiated between DICOM nodes. Additionally, the File Meta Info block contains the transfer syntax used to encode the Data Set.
// Assumption: we are using Explicit VR Little Endian. The default (Implicit VR Little Endian) is not widely used.
// Assumption: File Meta Elements follow the VRs listed here: https://dicom.nema.org/medical/dicom/current/output/chtml/part06/chapter_7.html
// Resources:
//   data element layout: https://www.leadtools.com/help/sdk/v20/dicom/api/overview-data-element-structure.html
//   transfer syntax info: https://pacsbootcamp.com/transfer-syntax
function* readFieldMetaInfo(
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

export type ReadDicomOptions = {
  stopAtElement?(group: number, element: number): boolean;
  onDataElement?: DataElementCallback;
};

export function* readDicomUntilPixelData(opts?: ReadDicomOptions) {
  const reader = new StreamingByteReader();

  // preamble
  yield* reader.seek(128);

  // prefix
  const prefix = yield* reader.readAscii(4);
  if (prefix !== 'DICM') {
    throw new Error('Not DICOM');
  }

  const info = yield* readFieldMetaInfo(reader, {
    onDataElement: opts?.onDataElement,
  });
  const explicitVr = info.transferSyntaxUid !== ImplicitTransferSyntaxUID;
  const littleEndian = info.transferSyntaxUid !== ExplicitVRBigEndianUID;

  yield* readDataElementsUntil(
    reader,
    // (7fe0,0010): Pixel Data
    (group, element) => opts?.stopAtElement?.(group, element) ?? false,
    { explicitVr, littleEndian, onDataElement: opts?.onDataElement }
  );

  return {
    position: reader.position,
  };
}

export const createDicomParser = (callbacks?: ReadDicomOptions) => {
  return asCoroutine(readDicomUntilPixelData(callbacks));
};
