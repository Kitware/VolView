import type { DicomDataset } from '@/packages/dicom/core';

/** Structured headers for fixtures whose values are written as tag strings. */
export const datasetFromTags = (
  tags: Iterable<readonly [string, string]>
): DicomDataset => ({
  specificCharacterSet: null,
  elements: [...tags].map(([key, value]) => {
    const tag = key.replace('|', '').toUpperCase();
    return {
      tag,
      group: parseInt(tag.slice(0, 4), 16),
      element: parseInt(tag.slice(4), 16),
      vr: 'LO',
      values: { kind: 'text', values: value.split('\\') },
    };
  }),
});
