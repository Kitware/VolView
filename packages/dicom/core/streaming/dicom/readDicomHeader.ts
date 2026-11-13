import { createDicomParser, ExplicitVRBigEndianUID } from './dicomParser';
import {
  IMPLICIT_VR_LITTLE_ENDIAN,
  type DicomLayout,
} from '../../metadata/dicomLayout';
import { concatBytes, toAscii } from '../../utils';

/** `skip-radiotherapy` returns after the Modality tag for RT objects. */
export type ImageImportPolicy = 'complete-header' | 'skip-radiotherapy';

/** Where the Pixel Data element and its value sit in the source. */
export type PixelDataElement = Readonly<{
  /** Offset of the element's tag. */
  offset: number;
  valueOffset: number;
  /** Value length in bytes; null for an undefined length, as encapsulated pixels have. */
  length: number | null;
}>;

const MODALITY = [0x0008, 0x0060] as const;
const PIXEL_DATA = [0x7fe0, 0x0010] as const;
/** Tag, VR, reserved bytes and a 32 bit length: the longest element head. */
const PIXEL_DATA_HEAD_LENGTH = 12;
const UNDEFINED_LENGTH = 0xffffffff;
const LONG_FORM_VRS = new Set(['OB', 'OD', 'OF', 'OL', 'OV', 'OW', 'UN']);

const isTag = (
  tag: readonly [number, number],
  group: number,
  element: number
) => group === tag[0] && element === tag[1];

/**
 * Radiotherapy objects are dropped on their modality alone, so nothing past
 * that element is read: a structure set carries megabytes of contours.
 */
const isRadiotherapy = (modality: string | undefined) =>
  modality?.startsWith('RT') ?? false;

function headerParser(policy: ImageImportPolicy) {
  const found = {
    modality: undefined as string | undefined,
    layout: null as DicomLayout | null,
    atPixelData: false,
  };
  const parse = createDicomParser({
    stopAtElement: (group, element) => {
      found.atPixelData = isTag(PIXEL_DATA, group, element);
      return (
        found.atPixelData ||
        (policy === 'skip-radiotherapy' && isRadiotherapy(found.modality))
      );
    },
    onLayout: (layout) => {
      found.layout = layout;
    },
    onDataElement: (el) => {
      if (
        isTag(MODALITY, el.group, el.element) &&
        el.data instanceof Uint8Array
      )
        found.modality = toAscii(el.data).trim();
    },
  });
  return { parse, found };
}

type Parse = ReturnType<typeof headerParser>['parse'];

/**
 * Reads until the parser stops, plus `trailing` bytes past that point. A
 * negative stop position asks for the complete file, as a deflated one needs.
 */
async function readUntilStop(
  stream: ReadableStream<Uint8Array>,
  parse: Parse,
  trailing: () => number
) {
  const received: Uint8Array[] = [];
  let total = 0;
  let stop: { position: number; transferSyntaxUid: string } | null = null;
  const result = () => ({
    received,
    end: stop && stop.position >= 0 ? stop.position : undefined,
    transferSyntaxUid: stop?.transferSyntaxUid ?? null,
  });
  const reader = stream.getReader();
  try {
    for (;;) {
      const { end } = result();
      if (end !== undefined && total >= end + trailing()) return result();
      const { done, value } = await reader.read();
      if (done) return result();
      received.push(value);
      total += value.length;
      const parsed: ReturnType<Parse> | null = stop ? null : parse(value);
      if (parsed?.done) stop = parsed.value;
    }
  } finally {
    // Not awaited, so the cancel lands before the stream refills its queue.
    reader.cancel().catch(() => {});
  }
}

/** Parses the Pixel Data element head; null when it is cut short or unexpected. */
function pixelDataElement(
  head: Uint8Array,
  offset: number,
  transferSyntaxUid: string
): PixelDataElement | null {
  if (head.length < 8) return null;
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
  const littleEndian = transferSyntaxUid !== ExplicitVRBigEndianUID;
  const element = (length: number, headLength: number) => ({
    offset,
    valueOffset: offset + headLength,
    length: length === UNDEFINED_LENGTH ? null : length,
  });
  if (transferSyntaxUid === IMPLICIT_VR_LITTLE_ENDIAN)
    return element(view.getUint32(4, littleEndian), 8);
  if (
    head.length < PIXEL_DATA_HEAD_LENGTH ||
    !LONG_FORM_VRS.has(toAscii(head.subarray(4, 6)))
  )
    return null;
  return element(view.getUint32(8, littleEndian), PIXEL_DATA_HEAD_LENGTH);
}

/**
 * Reads a stream up to its Pixel Data element head and cancels it there,
 * since a stream that reads ahead pulls pixel data a header never uses. An
 * object with no Pixel Data, such as a structured report, is header to its
 * last byte.
 */
export async function readDicomHeader(
  stream: ReadableStream<Uint8Array>,
  policy: ImageImportPolicy = 'complete-header'
) {
  const { parse, found } = headerParser(policy);
  const { received, end, transferSyntaxUid } = await readUntilStop(
    stream,
    parse,
    () => (found.atPixelData ? PIXEL_DATA_HEAD_LENGTH : 0)
  );
  const header = concatBytes(received, end);
  const head =
    found.atPixelData && end !== undefined
      ? concatBytes(received).subarray(end, end + PIXEL_DATA_HEAD_LENGTH)
      : null;
  return {
    header,
    layout: found.layout,
    transferSyntaxUid,
    pixelData:
      head && transferSyntaxUid
        ? pixelDataElement(head, end!, transferSyntaxUid)
        : null,
  };
}
