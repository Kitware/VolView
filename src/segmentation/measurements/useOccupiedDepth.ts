import * as Comlink from 'comlink';
import {
  computed,
  onScopeDispose,
  ref,
  shallowRef,
  unref,
  watch,
  type MaybeRef,
} from 'vue';
import { getErrorDetail } from '@/src/utils';
import { createWorkerHost } from '@/src/segmentation/editing/processWorker';
import type { OccupiedDepthInput, OccupiedDepthResult } from './occupiedDepth';
import type { OccupiedDepthWorkerApi } from './occupiedDepth.worker';
import type vtkLabelMap from '@/src/vtk/LabelMap';
import { createMaskSnapshot } from './maskSnapshot';

export type OccupiedDepthRequest = OccupiedDepthInput & {
  source: object;
  maskImage: vtkLabelMap;
  segment: string;
  grid: string;
};

function compatible(left: OccupiedDepthRequest, right: OccupiedDepthRequest) {
  return (
    left.source === right.source &&
    left.segment === right.segment &&
    left.grid === right.grid &&
    left.axis === right.axis &&
    left.first === right.first &&
    left.last === right.last &&
    left.dimensions.every((value, index) => value === right.dimensions[index])
  );
}

const spawnMeasurementWorker = () =>
  new Worker(new URL('./occupiedDepth.worker.ts', import.meta.url), {
    type: 'module',
  });

/** A view's worker, receiving changed voxel regions and reusing them across slabs. */
export function createWorkerMeasurer(spawn = spawnMeasurementWorker) {
  const host = createWorkerHost<OccupiedDepthWorkerApi>(spawn);
  let sentApi: unknown;
  let source: vtkLabelMap | undefined;
  let snapshot: ReturnType<typeof createMaskSnapshot> | undefined;
  return {
    measure: ({
      maskImage,
      mask,
      dimensions,
      axis,
      first,
      last,
    }: OccupiedDepthRequest) => {
      if (source !== maskImage) {
        snapshot?.dispose();
        source = maskImage;
        snapshot = createMaskSnapshot(maskImage);
      }
      const currentSnapshot = snapshot!;
      return host
        .call((api) => {
          // A respawned worker holds no mask, even when its source is unchanged.
          const update = currentSnapshot.take(mask, sentApi !== api);
          sentApi = api;
          const values =
            update?.kind === 'replace' ? update.mask.values : update?.values;
          return api.measure(
            { dimensions: [...dimensions], axis, first, last },
            update && values && Comlink.transfer(update, [values.buffer])
          );
        })
        .catch((cause) => {
          sentApi = undefined;
          currentSnapshot.invalidate();
          throw cause;
        });
    },
    release() {
      sentApi = undefined;
      source = undefined;
      snapshot?.dispose();
      snapshot = undefined;
      host.terminate();
    },
  };
}

export type OccupiedDepthMeasurer = ReturnType<typeof createWorkerMeasurer>;

/** Measures the latest request, keeping a compatible result while it updates. */
export function useOccupiedDepth(
  request: MaybeRef<OccupiedDepthRequest | null>,
  createMeasurer: () => OccupiedDepthMeasurer = createWorkerMeasurer
) {
  const measurer = createMeasurer();
  const latest = shallowRef<{
    input: OccupiedDepthRequest;
    result: OccupiedDepthResult;
  } | null>(null);
  const computing = ref(false);
  const error = ref<string | null>(null);
  let pending: OccupiedDepthRequest | null = null;
  let running = false;

  // One measurement at a time; requests superseded meanwhile are skipped.
  async function drain() {
    if (running) return;
    running = true;
    while (pending) {
      const input = pending;
      pending = null;
      let result: OccupiedDepthResult | null = null;
      let failure: string | null = null;
      try {
        result = await measurer.measure(input);
      } catch (cause) {
        failure = getErrorDetail(cause, 'Occupied depth measurement failed.');
      }
      if (input === unref(request)) {
        latest.value = result && { input, result };
        error.value = failure;
        computing.value = false;
      }
    }
    running = false;
  }

  watch(
    () => unref(request),
    (input) => {
      if (!input || (latest.value && !compatible(latest.value.input, input)))
        latest.value = null;
      error.value = null;
      computing.value = !!input;
      pending = input;
      // An idle view keeps no worker or mask copy.
      if (input) void drain();
      else measurer.release();
    },
    { immediate: true, flush: 'pre' }
  );
  onScopeDispose(measurer.release);
  const accepted = computed(() => {
    const input = unref(request);
    return input && latest.value && compatible(latest.value.input, input)
      ? latest.value.result
      : null;
  });
  return { accepted, computing, error };
}
