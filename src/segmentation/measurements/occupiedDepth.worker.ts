import * as Comlink from 'comlink';
import {
  createOccupiedDepthMeasurer,
  type OccupiedDepthInput,
} from '@/src/segmentation/measurements/occupiedDepth';

let measure: ReturnType<typeof createOccupiedDepthMeasurer> | undefined;

const api = {
  /** Without a mask, reuses the one this worker was last sent. */
  measure(
    input: Omit<OccupiedDepthInput, 'mask'>,
    mask?: OccupiedDepthInput['mask']
  ) {
    if (mask) {
      // A rejected replacement must not leave the previous mask measurable.
      measure = undefined;
      measure = createOccupiedDepthMeasurer(mask);
    }
    if (!measure) throw new Error('Occupied depth has no measurable mask.');
    const result = measure(input);
    return Comlink.transfer(result, [result.counts.buffer as ArrayBuffer]);
  },
};

export type OccupiedDepthWorkerApi = typeof api;

Comlink.expose(api);
