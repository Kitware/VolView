import { createOccupiedDepthMeasurer } from '@/src/segmentation/measurements/occupiedDepth';
import type { OccupiedDepthInput } from '@/src/segmentation/measurements/occupiedDepth';

export type MeasurementRequest = {
  id: number;
  input: Omit<OccupiedDepthInput, 'mask' | 'validity'>;
  /** Omitted when the worker already holds this mask revision. */
  mask?: OccupiedDepthInput['mask'];
  /** Omitted when the worker already holds this source revision. */
  source?: { validity?: Uint8Array };
};

let validity: Uint8Array | undefined;
let measure: ReturnType<typeof createOccupiedDepthMeasurer> | undefined;
self.onmessage = ({ data }: MessageEvent<MeasurementRequest>) => {
  if (data.source) validity = data.source.validity;
  try {
    if (data.mask) {
      measure = undefined;
      measure = createOccupiedDepthMeasurer(data.mask);
    }
    if (!measure) throw new Error('Occupied depth requires a binary mask.');
    const result = measure({ ...data.input, validity });
    self.postMessage({ id: data.id, result }, [
      result.counts.buffer,
      result.known.buffer,
    ]);
  } catch (cause) {
    self.postMessage({
      id: data.id,
      error:
        cause instanceof Error
          ? cause.message
          : 'Occupied depth measurement failed.',
    });
  }
};
