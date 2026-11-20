import type { DicomDataset, DicomElement } from './dicomDataset';
import { trimDicomPadding } from '../utils';

/** Text and numeric values retain multiplicity; sequences and opaque bytes do not become text. */
function getElementText({ values }: DicomElement) {
  switch (values.kind) {
    case 'text':
    case 'number':
      return values.values.join('\\');
    case 'decimal':
      return values.text.join('\\');
    default:
      return undefined;
  }
}

export function getDatasetTag(
  dataset: DicomDataset | null | undefined,
  tag: string
) {
  const element = dataset?.elements.find((entry) => entry.tag === tag);
  return element ? getElementText(element) : undefined;
}

export const getDatasetModality = (dataset: DicomDataset | null | undefined) =>
  trimDicomPadding(getDatasetTag(dataset, '00080060') ?? '') || null;
