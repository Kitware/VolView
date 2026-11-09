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

export type OccupiedDepthRequest = OccupiedDepthInput & {
  source: object;
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

/** A view's worker, sent each mask revision once and reusing it across slabs. */
export function createWorkerMeasurer(spawn = spawnMeasurementWorker) {
  const host = createWorkerHost<OccupiedDepthWorkerApi>(spawn);
  const sent = new Map<
    string,
    { api: unknown; mask: OccupiedDepthInput['mask'] }
  >();
  return {
    measure: ({
      mask,
      dimensions,
      axis,
      first,
      last,
      segment = '',
    }: OccupiedDepthInput & { segment?: string }) =>
      host.call((api) => {
        // A respawned worker holds no mask.
        const previous = sent.get(segment);
        const fresh = previous?.api !== api || previous?.mask !== mask;
        sent.set(segment, { api, mask });
        const values = fresh ? new Uint8Array(mask.values) : undefined;
        return api.measure(
          { dimensions: [...dimensions], axis, first, last },
          values &&
            Comlink.transfer(
              {
                values,
                dimensions: [...mask.dimensions],
                extent: [...mask.extent],
              },
              [values.buffer]
            ),
          segment
        );
      }),
    retain(segments: string[]) {
      if (!sent.size) return;
      const retained = new Set(segments);
      sent.forEach((_snapshot, segment) => {
        if (!retained.has(segment)) sent.delete(segment);
      });
      void host.call((api) => api.retain(segments)).catch(() => {});
    },
    release() {
      sent.clear();
      host.terminate();
    },
  };
}

export type OccupiedDepthMeasurer = Pick<
  ReturnType<typeof createWorkerMeasurer>,
  'measure' | 'release'
>;

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
  onScopeDispose(() => {
    pending = null;
    measurer.release();
  });
  const accepted = computed(() => {
    const input = unref(request);
    return input && latest.value && compatible(latest.value.input, input)
      ? latest.value.result
      : null;
  });
  return { accepted, computing, error };
}
