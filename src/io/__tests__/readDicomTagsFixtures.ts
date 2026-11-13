import { readDicomDataset } from '@/packages/dicom/core';
import { dicomDatasetToTags } from '../readDicomTags';

export const readDicomTags = (bytes: Uint8Array) =>
  dicomDatasetToTags(readDicomDataset(bytes));
