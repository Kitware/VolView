import type { Instance } from '../instance/readInstance';
import { getDatasetTag } from '../metadata/datasetAccess';
import {
  IMPLICIT_VR_LITTLE_ENDIAN,
  PART_10_HEADER_LENGTH,
} from '../metadata/dicomLayout';
import { Tags } from '../metadata/dicomTags';
import { concatBytes, trimDicomPadding } from '../utils';

const FILE_META_GROUP = 0x0002;
const encoder = new TextEncoder();

const tagBytes = (element: number) => {
  const bytes = new Uint8Array(4);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, FILE_META_GROUP, true);
  view.setUint16(2, element, true);
  return bytes;
};

/** An explicit VR little endian UI element, padded to even length with NUL. */
const uiElement = (element: number, uid: string) => {
  const value = encoder.encode(uid.length % 2 ? `${uid}\0` : uid);
  const head = new Uint8Array(4);
  head.set(encoder.encode('UI'));
  new DataView(head.buffer).setUint16(2, value.length, true);
  return concatBytes([tagBytes(element), head, value]);
};

const versionElement = () =>
  concatBytes([
    tagBytes(0x0001),
    encoder.encode('OB'),
    new Uint8Array([0, 0, 2, 0, 0, 0, 0, 1]),
  ]);

const groupLengthElement = (length: number) => {
  const value = new Uint8Array(8);
  value.set(encoder.encode('UL'));
  const view = new DataView(value.buffer);
  view.setUint16(2, 4, true);
  view.setUint32(4, length, true);
  return concatBytes([tagBytes(0x0000), value]);
};

/** Where a bare implicit VR data set's own group 0002 elements end. */
function pastImplicitMeta(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  while (
    offset + 8 <= bytes.length &&
    view.getUint16(offset, true) === FILE_META_GROUP
  )
    offset += 8 + view.getUint32(offset + 4, true);
  return Math.min(offset, bytes.length);
}

/**
 * The instance's bytes as a Part 10 file. GDCM in ITK reads only files with a
 * preamble and file meta information, so the ones the header reader accepts
 * without them get a written header naming the sniffed transfer syntax.
 */
export function asPart10(instance: Instance, bytes: Uint8Array) {
  const { layout } = instance;
  if (!layout || layout.preamble) return bytes;
  const preamble = new Uint8Array(PART_10_HEADER_LENGTH);
  preamble.set(encoder.encode('DICM'), PART_10_HEADER_LENGTH - 4);
  if (layout.fileMeta) return concatBytes([preamble, bytes]);

  const uid = (tag: string) =>
    trimDicomPadding(getDatasetTag(instance.dataset, tag) ?? '');
  const meta = concatBytes([
    versionElement(),
    uiElement(0x0002, uid(Tags.SOPClassUID)),
    uiElement(0x0003, uid(Tags.SOPInstanceUID)),
    uiElement(0x0010, layout.transferSyntaxUid),
  ]);
  const dataSet =
    layout.transferSyntaxUid === IMPLICIT_VR_LITTLE_ENDIAN
      ? bytes.subarray(pastImplicitMeta(bytes))
      : bytes;
  return concatBytes([
    preamble,
    groupLengthElement(meta.length),
    meta,
    dataSet,
  ]);
}
