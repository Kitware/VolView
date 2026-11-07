import { Chunk } from '@/packages/dicom/core/streaming/chunk';

import { getChunkTag } from '@/packages/dicom/core/metadata/datasetAccess';
import { Tags } from '@/packages/dicom/core/metadata/dicomTags';

/** The VOI attributes used when choosing a shared display window. */
export const getChunkWindowMetadata = (chunk: Chunk) =>
  [Tags.WindowLevel, Tags.WindowWidth, Tags.VOILUTFunction].flatMap((tag) => {
    const value = getChunkTag(chunk, tag);
    return value === undefined ? [] : [[tag, value] as const];
  });
