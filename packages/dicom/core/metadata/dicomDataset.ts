import {
  hex4,
  ParsedElement,
  ParsedValue,
  parseDicomElements,
} from './dcmjsParser';
import { trimDicomPadding } from '../utils';
import {
  CHARSET_VRS,
  characterSetDecoder,
  VALUE_DELIMITER,
} from './dicomCharacterSet';

const SPECIFIC_CHARACTER_SET = '00080005';

/** A tag as `ggggeeee` in upper case hexadecimal. */
type DicomTagKey = string;

type AttributeTag = { group: number; element: number };

/** Text VRs of value multiplicity 1, whose backslash is a character. */
const SINGLE_VALUED_TEXT_VRS = new Set(['LT', 'ST', 'UT']);

/** VRs holding a number written as characters. */
const DECIMAL_VRS = new Set(['DS', 'IS']);

type DicomValues =
  /** A text VR, one entry per value, with the Specific Character Set applied. */
  | { kind: 'text'; values: string[] }
  /** DS and IS: the numbers, next to the characters the file wrote. A value
   * that is not a number is null rather than zero. */
  | { kind: 'decimal'; values: Array<number | null>; text: string[] }
  /** A binary numeric VR. */
  | { kind: 'number'; values: number[] }
  /** AT, each value a referenced tag. */
  | { kind: 'attributeTag'; values: AttributeTag[] }
  /** SQ, one data set per item. */
  | { kind: 'sequence'; items: DicomDataset[] }
  /** A buffer VR. */
  | { kind: 'bytes'; values: Uint8Array[] }
  /** An element whose header was read and whose value was not. */
  | { kind: 'unread'; bytes: Uint8Array; reason: string };

export type DicomElement = {
  tag: DicomTagKey;
  group: number;
  element: number;
  vr: string;
  values: DicomValues;
};

export type DicomDataset = {
  /** Elements in the order the parser reported them. */
  elements: DicomElement[];
  /** (0008,0005) as this data set declares it, or null when it declares none. */
  specificCharacterSet: string[] | null;
};

const tagKey = (group: number, element: number) =>
  `${hex4(group)}${hex4(element)}`;

export const isPrivateElement = ({ group }: DicomElement) => (group & 1) === 1;

export const findElement = (dataset: DicomDataset, tag: DicomTagKey) =>
  dataset.elements.find((element) => element.tag === tag);

const isText = (value: ParsedValue): value is string =>
  typeof value === 'string';

const isNumber = (value: ParsedValue): value is number =>
  typeof value === 'number';

const isBytes = (value: ParsedValue): value is Uint8Array =>
  value instanceof Uint8Array;

const decimalOf = (text: string) => {
  const trimmed = trimDicomPadding(text);
  const value = Number(trimmed);
  return trimmed.length > 0 && Number.isFinite(value) ? value : null;
};

const attributeTagOf = (packed: number) => ({
  group: packed >>> 16,
  element: packed & 0xffff,
});

type CharacterSetDecoder = ReturnType<typeof characterSetDecoder>;

/**
 * dcmjs splits a value on every 0x5c byte, which GB18030, GBK and ISO 2022
 * write inside multibyte characters, so a value the character set reaches is
 * put back together and separated again once its characters are known.
 */
const textValues = (
  vr: string,
  values: string[],
  decode: CharacterSetDecoder
) => {
  if (!CHARSET_VRS.has(vr) || values.length === 0) return values;
  const raw = values.join(VALUE_DELIMITER);
  return SINGLE_VALUED_TEXT_VRS.has(vr)
    ? [decode.value(raw)]
    : decode.values(raw);
};

const classifiedValues = (
  vr: string,
  values: ParsedValue[],
  decode: CharacterSetDecoder
): DicomValues => {
  if (vr === 'AT' && values.every(isNumber))
    return { kind: 'attributeTag', values: values.map(attributeTagOf) };
  if (DECIMAL_VRS.has(vr) && values.every(isText))
    return { kind: 'decimal', values: values.map(decimalOf), text: values };
  if (values.every(isText))
    return { kind: 'text', values: textValues(vr, values, decode) };
  if (values.every(isNumber)) return { kind: 'number', values };
  if (values.every(isBytes)) return { kind: 'bytes', values };
  return {
    kind: 'unread',
    bytes: new Uint8Array(0),
    reason: `mixed value types for VR ${vr}`,
  };
};

const elementValues = (
  parsed: ParsedElement,
  decode: CharacterSetDecoder,
  charset: string[] | null
): DicomValues => {
  if (parsed.unread)
    return {
      kind: 'unread',
      bytes: parsed.unread.bytes,
      reason: parsed.unread.reason,
    };
  if (parsed.items)
    return {
      kind: 'sequence',
      items: parsed.items.map((item) => buildDataset(item, charset, decode)),
    };
  return classifiedValues(parsed.vr, parsed.values, decode);
};

const buildElement = (
  parsed: ParsedElement,
  decode: CharacterSetDecoder,
  charset: string[] | null
): DicomElement => ({
  tag: tagKey(parsed.group, parsed.element),
  group: parsed.group,
  element: parsed.element,
  vr: parsed.vr,
  values: elementValues(parsed, decode, charset),
});

// The declared set is the values the data set itself wrote, so a data set that
// declares none stays distinguishable from one that declares the default.
const declaredCharacterSet = (elements: ParsedElement[]) => {
  const found = elements.find(
    (element) =>
      tagKey(element.group, element.element) === SPECIFIC_CHARACTER_SET
  );
  return found ? found.values.filter(isText).map((name) => name.trim()) : null;
};

function buildDataset(
  elements: ParsedElement[],
  inherited: string[] | null,
  inheritedDecoder?: CharacterSetDecoder
): DicomDataset {
  const declared = declaredCharacterSet(elements);
  const charset = declared ?? inherited;
  const decode =
    declared === null && inheritedDecoder
      ? inheritedDecoder
      : characterSetDecoder(charset ?? []);
  return {
    elements: elements.map((element) => buildElement(element, decode, charset)),
    specificCharacterSet: declared,
  };
}

/**
 * Reads a header into a standards-shaped data set: every element before Pixel
 * Data keeps its tag, VR, value multiplicity and nested items. Nothing missing
 * is filled in.
 */
export const readDicomDataset = (bytes: Uint8Array) =>
  buildDataset(parseDicomElements(bytes), null);

/** Image loading uses public attributes; private payloads stay in the source. */
export const withoutPrivateElements = (
  dataset: DicomDataset
): DicomDataset => ({
  ...dataset,
  elements: dataset.elements
    .filter((element) => !isPrivateElement(element))
    .map((element) =>
      element.values.kind === 'sequence'
        ? {
            ...element,
            values: {
              ...element.values,
              items: element.values.items.map(withoutPrivateElements),
            },
          }
        : element
    ),
});

/** The data set an instance carries, filtered where it is parsed. */
export const readPublicDataset = (bytes: Uint8Array) =>
  withoutPrivateElements(readDicomDataset(bytes));
