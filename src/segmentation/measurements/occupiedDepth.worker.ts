import * as Comlink from 'comlink';
import {
  createOccupiedDepthSession,
  type OccupiedDepthInput,
  type OccupiedDepthMaskUpdate,
} from '@/src/segmentation/measurements/occupiedDepth';

const measure = createOccupiedDepthSession();

const api = {
  /** Without an update, reuses the mask this worker already holds. */
  measure(
    input: Omit<OccupiedDepthInput, 'mask'>,
    update?: OccupiedDepthMaskUpdate
  ) {
    const result = measure(input, update);
    return Comlink.transfer(result, [result.counts.buffer as ArrayBuffer]);
  },
};

export type OccupiedDepthWorkerApi = typeof api;

Comlink.expose(api);
