import type { Chunk } from '../core/streaming/chunk';
import { getChunkTag } from '../core/metadata/datasetAccess';
import { sliceNormalOf } from '../core/collections/instanceFacts';
import { readChunkFacts } from '../core/collections/chunkFacts';
import { reconstructInstances } from '../core/collections/reconstructVolume';
import type { Reconstruction } from '../core/collections/reconstructVolume';
import {
  allocateImageFromChunks,
  type IrregularGeometryPolicy,
} from './allocateImageFromChunks';
import { applyUltrasoundSpacing } from './ultrasoundSpacing';

const reconstructionFor = (
  chunks: Chunk[],
  orientation: number[] | null,
  supplied: Reconstruction | undefined
) => {
  const needsFrameGeometry =
    chunks.length === 1 && Number(getChunkTag(chunks[0], '00280008')) > 1;
  return supplied && !needsFrameGeometry
    ? supplied
    : reconstructInstances(
        chunks.map((chunk) => readChunkFacts(chunk).facts),
        sliceNormalOf(orientation),
        supplied
      );
};

/** Allocate off-screen; warnings become visible only when the image commits. */
export function prepareChunkAllocation(
  chunks: Chunk[],
  orientation: number[] | null,
  supplied: Reconstruction | undefined,
  policy: IrregularGeometryPolicy
) {
  if (chunks.length === 0)
    throw new Error('Cannot allocate an image from zero chunks');
  const reconstruction = reconstructionFor(chunks, orientation, supplied);
  const modality = getChunkTag(chunks[0], '00080060')?.trim();
  const allocated =
    modality === 'SEG'
      ? null
      : allocateImageFromChunks(chunks, orientation, reconstruction, policy);
  const warnings: Array<[string, string]> = [];
  try {
    const spatialMetadata = allocated
      ? applyUltrasoundSpacing(allocated, chunks, (...warning) =>
          warnings.push(warning)
        )
      : undefined;
    return {
      image: allocated?.image,
      reconstruction,
      spatialMetadata,
      warnings,
    };
  } catch (error) {
    allocated?.image.delete();
    throw error;
  }
}
