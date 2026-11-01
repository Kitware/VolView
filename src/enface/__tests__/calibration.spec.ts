import { describe, expect, it } from 'vitest';
import type { Chunk } from '@/src/core/streaming/chunk';
import { Tags } from '@/src/core/dicomTags';
import { allocateImageFromChunks } from '@/src/utils/allocateImageFromChunks';
import { OPHTHALMIC_TOMOGRAPHY_SOP } from '@/src/core/streaming/dicom/octMetadataTags';
import { measureOccupiedDepth } from '@/src/segmentation/measurements/occupiedDepth';

describe('OCT occupied depth through DICOM allocation', () => {
  it.each(['0.0104\\0', '0.0104\\NaN'])(
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
      expect(image.getSpacing()).toEqual([1, 0.0104, 0.1]);
      const result = measureOccupiedDepth({
        dimensions: image.getDimensions(),
        axis: 1,
        first: 0,
        last: 1,
        mask: {
          dimensions: image.getDimensions(),
          extent: [0, 1, 0, 1, 0, 1],
          values: new Uint8Array(8).fill(1),
        },
      });
      expect(
        Array.from(
          result.counts,
          (count) => count * image.getSpacing()[1] * 1000
        )
      ).toEqual(Array(4).fill(20.8));
      image.delete();
    }
  );
});
