import { z } from 'zod';

// Normalize before defaults so an explicitly empty legacy value still disables
// filename matching. Runtime consumers see only segmentationExtension.
export const configIo = z
  .object({
    segmentGroupSaveFormat: z.string().optional(),
    segmentationExtension: z.string().optional(),
    segmentGroupExtension: z.string().optional(),
    layerExtension: z.string().default(''),
  })
  .refine(
    (io) =>
      io.segmentGroupExtension === undefined ||
      io.segmentationExtension === undefined ||
      io.segmentGroupExtension === io.segmentationExtension,
    {
      path: ['segmentationExtension'],
      message:
        'io.segmentGroupExtension conflicts with io.segmentationExtension. Use only io.segmentationExtension.',
    }
  )
  .transform(({ segmentGroupExtension, segmentationExtension, ...io }) => ({
    ...io,
    segmentationExtension: segmentationExtension ?? segmentGroupExtension ?? '',
  }));
