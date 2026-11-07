import type { DicomDataset } from '@/packages/dicom/core/metadata/dicomDataset';
import { getDatasetTag } from '@/packages/dicom/core/metadata/datasetAccess';
import { sequenceItems } from '@/packages/dicom/core/metadata/functionalGroups';
import { trimDicomPadding } from '@/packages/dicom/core/utils';

/** The OCT policy reads attributes and their explicit sequence paths only. */
export type OCTDataset = {
  value: (tag: string) => string | undefined;
  items: (tag: string) => OCTDataset[];
};

const structuredTag = (tag: string) => tag.slice(1).toUpperCase();

/** Adapts already loaded metadata without reparsing or retaining source bytes. */
export const structuredOCTDataset = (dataset: DicomDataset): OCTDataset => ({
  value: (tag) => {
    const value = getDatasetTag(dataset, structuredTag(tag));
    return value === undefined ? undefined : trimDicomPadding(value);
  },
  items: (tag) =>
    sequenceItems(dataset, structuredTag(tag)).map(structuredOCTDataset),
});
