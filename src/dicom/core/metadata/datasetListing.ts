import dcmjs from 'dcmjs';
import type { DicomDataset, DicomElement } from './dicomDataset';
import { hex4 } from './dcmjsParser';

const { DicomMetaDictionary } = dcmjs.data;

/** Values past this count are summarized so one long array cannot flood the listing. */
const SHOWN_VALUES = 16;
/** Long texts, such as an LT or UT report, are cut at this length. */
const SHOWN_CHARACTERS = 256;

export type DatasetRow = {
  tag: string;
  name: string;
  vr: string;
  value: string;
  /** Sequence nesting, 0 at the top level. */
  depth: number;
};

const join = (values: readonly unknown[]) => {
  const shown = values.slice(0, SHOWN_VALUES).join('\\');
  return values.length > SHOWN_VALUES
    ? `${shown}\\… (${values.length} values)`
    : shown;
};

const truncate = (text: string) =>
  text.length > SHOWN_CHARACTERS
    ? `${text.slice(0, SHOWN_CHARACTERS)}… (${text.length} characters)`
    : text;

function valueText({ values }: DicomElement) {
  switch (values.kind) {
    case 'text':
      return join(values.values);
    case 'decimal':
      return join(values.text);
    case 'number':
      return join(values.values);
    case 'attributeTag':
      return join(
        values.values.map(
          ({ group, element }) => `(${hex4(group)},${hex4(element)})`
        )
      );
    case 'sequence':
      return `${values.items.length} item${values.items.length === 1 ? '' : 's'}`;
    case 'bytes':
      return `${values.values.reduce((sum, bytes) => sum + bytes.length, 0)} bytes`;
    case 'unread':
      return `Not read: ${values.reason}`;
    default:
      return '';
  }
}

/** Flattens a data set into display rows, nesting sequence items beneath their element. */
export function listDataset(dataset: DicomDataset, depth = 0): DatasetRow[] {
  return dataset.elements.flatMap((element) => {
    const tag = `(${hex4(element.group)},${hex4(element.element)})`;
    const row = {
      tag,
      name: DicomMetaDictionary.dictionary[tag]?.name ?? '',
      vr: element.vr,
      value: truncate(valueText(element)),
      depth,
    };
    if (element.values.kind !== 'sequence') return [row];
    return [
      row,
      ...element.values.items.flatMap((item) => listDataset(item, depth + 1)),
    ];
  });
}
