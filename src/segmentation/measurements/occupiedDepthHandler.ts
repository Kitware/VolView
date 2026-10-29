import { createOccupiedDepthMeasurer } from '@/src/segmentation/measurements/occupiedDepth';
import type {
  OccupiedDepthInput,
  OccupiedDepthResult,
} from '@/src/segmentation/measurements/occupiedDepth';

export type MeasurementRequest = {
  id: number;
  input: Omit<OccupiedDepthInput, 'mask' | 'validity'>;
  /** Omitted when the worker already holds this mask revision. */
  mask?: OccupiedDepthInput['mask'];
  /** Omitted when the worker already holds this source revision. */
  source?: { validity?: OccupiedDepthInput['validity'] };
};

export type MeasurementResponse = {
  id: number;
  result?: OccupiedDepthResult;
  error?: string;
};

/** Owns the prepared snapshots for one worker. */
export function createOccupiedDepthHandler() {
  let validity: OccupiedDepthInput['validity'];
  let measure: ReturnType<typeof createOccupiedDepthMeasurer> | undefined;
  return (data: MeasurementRequest): MeasurementResponse => {
    if (data.source) validity = data.source.validity;
    try {
      if (data.mask) {
        measure = undefined;
        measure = createOccupiedDepthMeasurer(data.mask);
      }
      if (!measure) throw new Error('Occupied depth requires a binary mask.');
      return { id: data.id, result: measure({ ...data.input, validity }) };
    } catch (cause) {
      return {
        id: data.id,
        error:
          cause instanceof Error
            ? cause.message
            : 'Occupied depth measurement failed.',
      };
    }
  };
}
