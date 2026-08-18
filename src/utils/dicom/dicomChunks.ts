import { vec3 } from 'gl-matrix';
import { Chunk } from '@/src/core/streaming/chunk';
import { Maybe } from '@/src/types';

/** Chunk metadata as a Map. For reading many tags off a single chunk. */
export const getChunkMetadata = (chunk: Chunk) => new Map(chunk.metadata ?? []);

/** Parses a backslash-delimited DICOM multi-value string. */
export function toVec(value: Maybe<string>) {
  if (!value?.length) return null;
  return value.split('\\').map(Number);
}

/** Slice normal: cross product of the ImageOrientationPatient row and column. */
export function getSliceNormal(imageOrientationPatient: number[]) {
  const normal = vec3.create();
  vec3.cross(
    normal,
    imageOrientationPatient.slice(0, 3) as vec3,
    imageOrientationPatient.slice(3, 6) as vec3
  );
  return normal;
}
