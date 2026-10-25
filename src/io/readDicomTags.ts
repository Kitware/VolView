import { binaryString, hex4 } from '@/src/io/dcmjsParser';
import { VALUE_DELIMITER } from '@/src/io/dicomCharacterSet';
import {
  DicomElement,
  isPrivateElement,
  readDicomDataset,
} from '@/src/io/dicomDataset';

const SPECIFIC_CHARACTER_SET = '00080005';

/** VRs whose values are binary floats rather than text. */
const FLOAT_VRS = new Set(['FD', 'FL', 'OD', 'OF']);

/** Significant digits of a C++ `ostream`, which is what GDCM printed with. */
const FLOAT_PRECISION = 6;

const hexTag = (value: number) => hex4(value).toLowerCase();

/** An AT value is a packed tag, which GDCM printed as `(gggg,eeee)`. */
const attributeTagText = ({
  group,
  element,
}: {
  group: number;
  element: number;
}) => `(${hexTag(group)},${hexTag(element)})`;

/** C++ `ostream` default formatting, which is `%g` with six significant digits. */
const floatText = (value: number) => {
  if (!Number.isFinite(value)) return String(value);
  const trim = (text: string) =>
    text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
  const [mantissa, exponent] = value
    .toExponential(FLOAT_PRECISION - 1)
    .split('e');
  const power = Number(exponent);
  return power < -4 || power >= FLOAT_PRECISION
    ? `${trim(mantissa)}e${power < 0 ? '-' : '+'}${String(Math.abs(power)).padStart(2, '0')}`
    : trim(value.toFixed(Math.max(0, FLOAT_PRECISION - 1 - power)));
};

const numberText = (vr: string, value: number) =>
  FLOAT_VRS.has(vr) || !Number.isInteger(value)
    ? floatText(value)
    : String(value);

const byTag = (a: [string, string], b: [string, string]) =>
  Number(a[0] > b[0]) - Number(a[0] < b[0]);

const itkTag = (tag: string) =>
  `${tag.slice(0, 4)}|${tag.slice(4)}`.toLowerCase();

const itkValue = ({ vr, values }: DicomElement) => {
  switch (values.kind) {
    case 'text':
      return values.values.join(VALUE_DELIMITER);
    case 'decimal':
      return values.text.join(VALUE_DELIMITER);
    case 'number':
      return values.values
        .map((value) => numberText(vr, value))
        .join(VALUE_DELIMITER);
    case 'attributeTag':
      return values.values.map(attributeTagText).join(VALUE_DELIMITER);
    case 'bytes':
      return values.values
        .map((bytes) => btoa(binaryString(bytes)))
        .join(VALUE_DELIMITER);
    default:
      return '';
  }
};

// GDCM reported no sequence and no private element, and an element it could not
// read did not reach its output either.
const reportedByItk = (element: DicomElement) =>
  !isPrivateElement(element) &&
  element.values.kind !== 'sequence' &&
  element.values.kind !== 'unread';

/**
 * Reads a DICOM file's header tags, stopping before Pixel Data, in the shape
 * and value formatting `@itk-wasm/dicom`'s `readDicomTags` produced: `gggg|eeee`
 * keys sorted by tag, multiple values joined with a backslash, binary VRs as
 * plain decimals, and text padding left as the file wrote it.
 */
export function readDicomTags(bytes: Uint8Array): Array<[string, string]> {
  const dataset = readDicomDataset(bytes);
  const pairs = dataset.elements
    .filter(reportedByItk)
    .map((element): [string, string] => [
      itkTag(element.tag),
      itkValue(element),
    ]);

  // GDCM reported an empty Specific Character Set for a file that declares none.
  const withCharset: Array<[string, string]> =
    dataset.specificCharacterSet === null
      ? [...pairs, [itkTag(SPECIFIC_CHARACTER_SET), '']]
      : pairs;

  return withCharset.sort(byTag);
}
