import { describe, expect, it } from 'vitest';
import type { Chunk } from '@/src/core/streaming/chunk';
import { Tags } from '@/src/core/dicomTags';
import { allocateImageFromChunks } from '@/src/utils/allocateImageFromChunks';
import {
  octCalibratedAxes,
  OPHTHALMIC_TOMOGRAPHY_SOP,
} from '@/src/oct/detection';
import { projectEnFace } from '@/src/oct/projection';

describe('OCT physical calibration through DICOM allocation', () => {
  it.each(['0.0104\\0', '0.0104\\NaN', '0.0104'])(
    'measures the declared A-line spacing when another axis is unavailable: %s',
    (pixelSpacing) => {
      const metadata = Object.entries({
        [Tags.SOPClassUID]: OPHTHALMIC_TOMOGRAPHY_SOP,
        [Tags.Rows]: '2',
        [Tags.Columns]: '2',
        [Tags.NumberOfFrames]: '2',
        [Tags.BitsStored]: '16',
        [Tags.PixelRepresentation]: '0',
        [Tags.PixelSpacing]: pixelSpacing,
        [Tags.SpacingBetweenSlices]: '0.1',
      });
      const image = allocateImageFromChunks([{ metadata } as unknown as Chunk]);
      expect(octCalibratedAxes(metadata)).toEqual([false, true, true]);
      const result = projectEnFace({
        volume: {
          dimensions: image.getDimensions(),
          spacing: image.getSpacing(),
          scalars: image.getPointData().getScalars().getData(),
        },
        axis: 1,
        method: 'mean',
        depthStart: 0,
        depthEnd: 1,
        segmentation: {
          dimensions: image.getDimensions(),
          scalars: new Uint8Array(8).fill(1),
          thresholdMicrons: 100,
        },
      });
      expect(Array.from(result.thicknessMicrons!)).toEqual(Array(4).fill(20.8));
      expect(Array.from(result.thinMask!)).toEqual([1, 1, 1, 1]);
      image.delete();
    }
  );
});
