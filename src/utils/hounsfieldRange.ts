import { DEFAULT_PRESET } from '@/src/config';
import { hasVisibleOpacity } from '@/src/utils/vtk-helpers';

// Air is -1000 HU. Halfway to fat (-100) survives smoothing and resampling,
// while magnitude MR and normalized intensities stay above it.
const AIR_LEVEL = -500;

/** Whether an untagged scalar range reads as CT in Hounsfield units. */
export const looksLikeHounsfieldRange = (range: readonly [number, number]) =>
  range[0] <= AIR_LEVEL && hasVisibleOpacity(DEFAULT_PRESET, range);
