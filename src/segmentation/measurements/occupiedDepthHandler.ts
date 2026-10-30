import { createOccupiedDepthMeasurer } from '@/src/segmentation/measurements/occupiedDepth';
import type {
  OccupiedDepthInput,
  OccupiedDepthResult,
} from '@/src/segmentation/measurements/occupiedDepth';

export type MeasurementRequest = {
  id: number;
  input: Omit<OccupiedDepthInput, 'mask'>;
  /** Omitted when the worker already holds this mask revision. */
  mask?: OccupiedDepthInput['mask'];
};

export type MeasurementResponse = {
  id: number;
  result?: OccupiedDepthResult;
  error?: string;
};

/** Owns the prepared mask snapshot for one worker. */
export function createOccupiedDepthHandler() {
  let measure: ReturnType<typeof createOccupiedDepthMeasurer> | undefined;
  return (data: MeasurementRequest): MeasurementResponse => {
    try {
      if (data.mask) {
        measure = undefined;
        measure = createOccupiedDepthMeasurer(data.mask);
      }
      if (!measure) throw new Error('Occupied depth requires a binary mask.');
      return { id: data.id, result: measure(data.input) };
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
