import { isPresentThicknessBelow } from '@/src/oct/thickness';
import type { ProjectionResult } from '@/src/oct/types';

export const createThinRegionMask = (
  result: ProjectionResult,
  threshold: number
) =>
  Uint8Array.from(result.values, (value, index) =>
    Number.isFinite(value) &&
    result.thicknessMicrons &&
    isPresentThicknessBelow(result.thicknessMicrons[index], threshold)
      ? 1
      : 0
  );

/** Missing intensities need coverage independent of the scalar window. */
export const createInvalidPixelMask = (result: ProjectionResult) =>
  Uint8Array.from(result.values, (value) => (Number.isFinite(value) ? 0 : 1));
