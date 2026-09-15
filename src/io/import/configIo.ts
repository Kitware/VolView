import { z } from 'zod';

export const RENAMED_IO_KEYS = [
  ['segmentGroupExtension', 'segmentationExtension'],
  ['segmentGroupSaveFormat', 'segmentationSaveFormat'],
] as const;

// Defaults apply after normalizing, or segmentationExtension's default would
// shadow a legacy value. Runtime consumers see only canonical keys.
export const configIo = z
  .object({
    segmentationSaveFormat: z.string().optional(),
    segmentGroupSaveFormat: z.string().optional(),
    segmentationExtension: z.string().optional(),
    segmentGroupExtension: z.string().optional(),
    layerExtension: z.string().default(''),
  })
  .superRefine((io, ctx) =>
    RENAMED_IO_KEYS.forEach(([legacy, key]) => {
      if (
        io[legacy] !== undefined &&
        io[key] !== undefined &&
        io[legacy] !== io[key]
      )
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `io.${legacy} conflicts with io.${key}. Use only io.${key}.`,
        });
    })
  )
  .transform(
    ({
      segmentGroupExtension,
      segmentationExtension,
      segmentGroupSaveFormat,
      segmentationSaveFormat,
      ...io
    }) => ({
      ...io,
      segmentationExtension:
        segmentationExtension ?? segmentGroupExtension ?? '',
      segmentationSaveFormat: segmentationSaveFormat ?? segmentGroupSaveFormat,
    })
  );
