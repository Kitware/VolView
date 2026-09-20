import * as Comlink from 'comlink';
import {
  fillHoles,
  FillHolesOptions,
} from '@/src/segmentation/editing/algorithms/fillHoles';

// Runs the pure flood-fill off the main thread so whole-volume fills do not
// freeze the UI, mirroring gaussianSmooth.worker.ts. Undefined when no hole was
// filled, which is the process's "nothing to do".
export function fillHolesWorker(input: FillHolesOptions) {
  const out = fillHoles(input);
  const filled = out.some((value, index) => value !== input.data[index]);
  if (!filled) return undefined;
  // Moved back rather than cloned, as the input was moved in.
  return Comlink.transfer(
    out,
    ArrayBuffer.isView(out) ? [out.buffer as ArrayBuffer] : []
  );
}

const workerApi = {
  fillHolesWorker,
};

Comlink.expose(workerApi);
