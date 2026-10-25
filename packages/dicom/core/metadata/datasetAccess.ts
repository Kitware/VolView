import type { DicomDataset, DicomElement } from './dicomDataset';
import type { Chunk } from '../streaming/chunk';

const canonicalTag = (tag: string) => tag.replace('|', '').toUpperCase();

/** Text and numeric values retain multiplicity; sequences and opaque bytes do not become text. */
export function getElementText(element: DicomElement): string | undefined {
  const { values } = element;
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
  const requestedTag = canonicalTag(tag);
  const element = dataset?.elements.find((entry) => entry.tag === requestedTag);
  return element ? getElementText(element) : undefined;
}

export const getChunkTag = (chunk: Chunk, tag: string) =>
  getDatasetTag(chunk.metadata, tag);
