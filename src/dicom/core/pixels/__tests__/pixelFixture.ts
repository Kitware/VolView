import { readInstance, type Instance } from '../../instance/readInstance';
import { fromBlob } from '../../source/byteSource';
import {
  nativePixelDicom,
  type DataElement,
  type NativePixelOptions,
} from '@/tests/nativePixelDicom';

/** The instance the runtime would read from these file bytes. */
export const instanceOf = (bytes: Uint8Array) =>
  readInstance(
    fromBlob(new Blob([bytes as Uint8Array<ArrayBuffer>])),
    new AbortController().signal
  );

/** An instance read from a synthesized file, as the runtime would read it. */
export async function pixelInstance(options: NativePixelOptions = {}) {
  const bytes = nativePixelDicom(options);
  return { bytes, instance: await instanceOf(bytes) };
}

/** 16 bit words as the bytes a file of that byte order holds. */
export function wordBytes(words: readonly number[], littleEndian = true) {
  const bytes = new Uint8Array(words.length * 2);
  const view = new DataView(bytes.buffer);
  words.forEach((word, index) => view.setUint16(index * 2, word, littleEndian));
  return bytes;
}

const PALETTE_DESCRIPTOR = 0x00281101;
export const PALETTE_DATA = 0x00281201;
export const SEGMENTED_PALETTE_DATA = 0x00281221;

/** A palette's elements: red, green and blue tables under one descriptor. */
export const paletteElements = (
  descriptor: readonly number[],
  tables: readonly Uint8Array[],
  dataTag = PALETTE_DATA
): DataElement[] =>
  tables.flatMap((table, channel) => [
    { tag: PALETTE_DESCRIPTOR + channel, vr: 'US', value: descriptor },
    { tag: dataTag + channel, vr: 'OW', value: table },
  ]);

/**
 * A Modality LUT Sequence of one item. `data` is LUT Data as the file holds
 * it: bytes for OW, numbers for US. An undefined descriptor or data leaves
 * the item without that element.
 */
export const modalityLutElement = (
  descriptor: readonly number[] | undefined,
  data: Uint8Array | readonly number[] | undefined
): DataElement => ({
  tag: 0x00283000,
  vr: 'SQ',
  value: [
    [
      ...(descriptor ? [{ tag: 0x00283002, vr: 'US', value: descriptor }] : []),
      ...(data
        ? [
            {
              tag: 0x00283006,
              vr: data instanceof Uint8Array ? 'OW' : 'US',
              value: data,
            },
          ]
        : []),
    ],
  ],
});

/** The same instance with its Photometric Interpretation replaced. */
export const withPhotometric = (
  instance: Instance,
  photometric: string
): Instance => ({
  ...instance,
  dataset: {
    ...instance.dataset,
    elements: instance.dataset.elements.map((element) =>
      element.tag === '00280004'
        ? { ...element, values: { kind: 'text', values: [photometric] } }
        : element
    ),
  },
});

/** The same instance with one numeric header value replaced. */
export const withNumber = (
  instance: Instance,
  tag: string,
  value: number
): Instance => ({
  ...instance,
  dataset: {
    ...instance.dataset,
    elements: instance.dataset.elements.map((element) =>
      element.tag === tag
        ? { ...element, values: { kind: 'number', values: [value] } }
        : element
    ),
  },
});
