import { toAscii } from '@/src/utils';

/**
 * How a DICOM byte stream opens.
 *
 * Part 10 puts 128 bytes of preamble and the letters DICM before the file meta
 * information, but files written without them are common enough that GDCM
 * reads them, so the opening is sniffed rather than required: the file meta
 * information may start at the first byte, or the data set itself may, with
 * nothing to name its transfer syntax but the shape of its first element.
 */
export const PREAMBLE_LENGTH = 128;
export const DICOM_PREFIX = 'DICM';
/** The bytes a Part 10 file spends before its first element. */
export const PART_10_HEADER_LENGTH = PREAMBLE_LENGTH + DICOM_PREFIX.length;

export const IMPLICIT_VR_LITTLE_ENDIAN = '1.2.840.10008.1.2';
export const EXPLICIT_VR_LITTLE_ENDIAN = '1.2.840.10008.1.2.1';

export type DicomLayout =
  /** Part 10: preamble, prefix and file meta information. */
  | { preamble: true; fileMeta: true }
  /** File meta information from the first byte, with no preamble. */
  | { preamble: false; fileMeta: true }
  /**
   * A bare data set, with no file meta information to name its transfer
   * syntax. The syntax is what the encoding of the first element suggests.
   */
  | { preamble: false; fileMeta: false; transferSyntaxUid: string };

const FILE_META_GROUP = 0x0002;

/**
 * The group a bare data set opens with: every SOP instance carries a SOP Class
 * UID in it, and Specific Character Set and Image Type sort ahead of that.
 * Bytes that open with any other group are not a data set, and reading them
 * as one would take arbitrary noise for a header.
 */
const FIRST_DATA_SET_GROUP = 0x0008;

/** The bytes needed to judge one element's tag and, in explicit VR, its VR. */
const ELEMENT_HEAD_LENGTH = 6;

// prettier-ignore
const VRS = new Set([
  'AE', 'AS', 'AT', 'CS', 'DA', 'DS', 'DT', 'FD', 'FL', 'IS', 'LO', 'LT', 'OB',
  'OD', 'OF', 'OL', 'OV', 'OW', 'PN', 'SH', 'SL', 'SQ', 'SS', 'ST', 'SV', 'TM',
  'UC', 'UI', 'UL', 'UN', 'UR', 'US', 'UT', 'UV',
]);

const littleEndianGroup = (head: Uint8Array) => head[0] | (head[1] << 8);

/** Whether the two bytes after the first tag spell a VR, as explicit VR does. */
const opensWithVr = (head: Uint8Array) =>
  VRS.has(toAscii(head.subarray(4, ELEMENT_HEAD_LENGTH)));

/**
 * Reads how `head` opens. `head` should hold the first 132 bytes of the file;
 * fewer decide what they can. Throws when no reading fits, since guessing past
 * this point would parse noise as a header.
 */
export function sniffDicomLayout(head: Uint8Array): DicomLayout {
  if (
    head.length >= PART_10_HEADER_LENGTH &&
    toAscii(head.subarray(PREAMBLE_LENGTH, PART_10_HEADER_LENGTH)) ===
      DICOM_PREFIX
  )
    return { preamble: true, fileMeta: true };

  if (head.length < ELEMENT_HEAD_LENGTH)
    throw new Error('Not DICOM: too short to hold a data element');

  // File meta information is always explicit VR little endian.
  const group = littleEndianGroup(head);
  if (group === FILE_META_GROUP && opensWithVr(head))
    return { preamble: false, fileMeta: true };

  if (group !== FIRST_DATA_SET_GROUP)
    throw new Error(
      'Not DICOM: no preamble, file meta information or data set'
    );

  return {
    preamble: false,
    fileMeta: false,
    transferSyntaxUid: opensWithVr(head)
      ? EXPLICIT_VR_LITTLE_ENDIAN
      : IMPLICIT_VR_LITTLE_ENDIAN,
  };
}
