import {
  knownResultIntentSchema,
  type KnownResultIntent,
} from '@/backend-contract';
import type { ProcessingResult } from '@/src/processing/types';

export const resultToIntent = (
  result: ProcessingResult
): KnownResultIntent | undefined => {
  // A known intent name with an invalid shape must not be applied.
  const known = knownResultIntentSchema.safeParse(result);
  return known.success ? known.data : undefined;
};
