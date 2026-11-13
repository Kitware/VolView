import * as Comlink from 'comlink';
import {
  createOccupiedDepthMeasurer,
  type OccupiedDepthInput,
} from '@/src/segmentation/measurements/occupiedDepth';

const measurements = new Map<
  string,
  ReturnType<typeof createOccupiedDepthMeasurer>
>();

const api = {
  /** Without a mask, reuses the snapshot for this segment. */
  measure(
    input: Omit<OccupiedDepthInput, 'mask'>,
    mask?: OccupiedDepthInput['mask'],
    segment = ''
  ) {
    if (mask) {
      // A rejected replacement must not leave the previous mask measurable.
      measurements.delete(segment);
      measurements.set(segment, createOccupiedDepthMeasurer(mask));
    }
    const measure = measurements.get(segment);
    if (!measure) throw new Error('Occupied depth has no measurable mask.');
    const result = measure(input);
    return Comlink.transfer(result, [result.counts.buffer as ArrayBuffer]);
  },
  retain(segments: string[]) {
    const retained = new Set(segments);
    measurements.forEach((_measurement, segment) => {
      if (!retained.has(segment)) measurements.delete(segment);
    });
  },
};

export type OccupiedDepthWorkerApi = typeof api;

Comlink.expose(api);
