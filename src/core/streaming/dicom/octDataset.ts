import {
  getDatasetTag,
  sequenceItems,
  trimDicomPadding,
  type DicomDataset,
} from '@/packages/dicom/core';

/** The OCT policy reads attributes and their explicit sequence paths only. */
export type OCTDataset = {
  value: (tag: string) => string | undefined;
  items: (tag: string) => OCTDataset[];
};

/** Adapts already loaded metadata without reparsing or retaining source bytes. */
export const structuredOCTDataset = (dataset: DicomDataset): OCTDataset => ({
  value: (tag) => {
    const value = getDatasetTag(dataset, tag);
    return value === undefined ? undefined : trimDicomPadding(value);
  },
  items: (tag) => sequenceItems(dataset, tag).map(structuredOCTDataset),
});
