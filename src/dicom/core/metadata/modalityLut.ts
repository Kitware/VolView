import type { DicomDataset, DicomElement } from './dicomDataset';
import { findElement } from './dicomDataset';
import { getDatasetTag } from './datasetAccess';
import { sequenceItems } from './functionalGroups';
import { trimDicomPadding } from '../utils';

/** A Modality LUT Sequence item: the table that replaces Rescale Slope and Intercept. */
export type ModalityLut = Readonly<{
  /** The stored value the first entry stands for. */
  firstMapped: number;
  /** Bits of each output value, which is unsigned. */
  bits: number;
  values: Uint16Array;
}>;

const MODALITY_LUT_SEQUENCE = '00283000';
const LUT_DESCRIPTOR = '00283002';
const LUT_DATA = '00283006';

// X-Ray Angiographic, X-Ray Radiofluoroscopic and the retired biplane image
// carry a table that turns stored values back into beam intensity. Their
// stored values are the ones meant for display (PS3.3 C.8.7.1.1.2), so
// viewers leave it unapplied.
const DISPLAYED_AS_STORED = new Set([
  '1.2.840.10008.5.1.4.1.1.12.1',
  '1.2.840.10008.5.1.4.1.1.12.2',
  '1.2.840.10008.5.1.4.1.1.12.3',
]);

const tableItem = (dataset: DicomDataset | null | undefined) => {
  if (!dataset) return undefined;
  const sopClass = trimDicomPadding(getDatasetTag(dataset, '00080016') ?? '');
  if (DISPLAYED_AS_STORED.has(sopClass)) return undefined;
  return sequenceItems(dataset, MODALITY_LUT_SEQUENCE).find(
    (item) => getDatasetTag(item, LUT_DESCRIPTOR) && findElement(item, LUT_DATA)
  );
};

/** Bits of the values an applied Modality LUT yields, or undefined with none. */
export function modalityLutBits(dataset: DicomDataset | null | undefined) {
  const item = tableItem(dataset);
  const bits = Number(getDatasetTag(item, LUT_DESCRIPTOR)?.split('\\')[2]);
  return item && bits >= 1 && bits <= 16 ? bits : undefined;
}

/** LUT Data as numbers: US values, one byte an entry, or 16 bit words. */
function tableValues(
  data: DicomElement['values'],
  entries: number,
  littleEndian: boolean
) {
  if (data.kind === 'number') return Uint16Array.from(data.values);
  if (data.kind !== 'bytes') return undefined;
  const [bytes] = data.values;
  // A table shorter than two bytes an entry holds one byte an entry.
  if (bytes.length < entries * 2)
    return Uint16Array.from(bytes.subarray(0, entries));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  return Uint16Array.from({ length: entries }, (_, index) =>
    view.getUint16(index * 2, littleEndian)
  );
}

/** The Modality LUT to apply to a data set's stored values, if it has one. */
export function readModalityLut(
  dataset: DicomDataset,
  littleEndian: boolean
): ModalityLut | undefined {
  const item = tableItem(dataset);
  const bits = modalityLutBits(dataset);
  if (!item || !bits) return undefined;
  const [count, first] = getDatasetTag(item, LUT_DESCRIPTOR)!
    .split('\\')
    .map(Number);
  const values = tableValues(
    findElement(item, LUT_DATA)!.values,
    count || 2 ** 16,
    littleEndian
  );
  // Implicit VR reads the descriptor as unsigned, whatever the pixels are.
  const signed = Number(getDatasetTag(dataset, '00280103')) === 1;
  const firstMapped = signed && first > 0x7fff ? first - 0x10000 : first;
  return values && { firstMapped, bits, values };
}
