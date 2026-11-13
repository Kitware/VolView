import type { DicomDataset } from '@/packages/dicom/core/metadata/dicomDataset';
import { getDatasetTag } from '@/packages/dicom/core/metadata/datasetAccess';
import { Tags } from '@/packages/dicom/core/metadata/dicomTags';

/** The VOI attributes used when choosing a shared display window. */
export const getWindowMetadata = (dataset: DicomDataset) =>
  [Tags.WindowLevel, Tags.WindowWidth, Tags.VOILUTFunction].flatMap((tag) => {
    const value = getDatasetTag(dataset, tag);
    return value === undefined ? [] : [[tag, value] as const];
  });
