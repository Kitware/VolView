import { readDicomDataset } from '@/packages/dicom/core/metadata/dicomDataset';
import { dicomDatasetToTags } from '../readDicomTags';

export const readDicomTags = (bytes: Uint8Array) =>
  dicomDatasetToTags(readDicomDataset(bytes));
