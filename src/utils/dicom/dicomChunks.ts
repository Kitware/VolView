import { Chunk } from '@/packages/dicom/core/streaming/chunk';

import { dicomDatasetToTags } from '@/src/io/readDicomTags';

/** Flat header strings used by the patient browser and application adapters. */
export const getChunkMetadata = (chunk: Chunk) =>
  new Map(chunk.metadata ? dicomDatasetToTags(chunk.metadata) : []);
