import * as Comlink from 'comlink';
import {
  fillHoles,
  FillHolesOptions,
} from '@/src/segmentation/editing/algorithms/fillHoles';

// Runs the pure flood-fill off the main thread so whole-volume fills do not
// freeze the UI, mirroring gaussianSmooth.worker.ts.
export function fillHolesWorker(input: FillHolesOptions) {
  return fillHoles(input);
}

const workerApi = {
  fillHolesWorker,
};

Comlink.expose(workerApi);
