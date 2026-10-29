import {
  onScopeDispose,
  ref,
  shallowRef,
  unref,
  watch,
  type MaybeRef,
} from 'vue';
import type { OccupiedDepthInput, OccupiedDepthResult } from './occupiedDepth';
import type { MeasurementRequest } from './occupiedDepth.worker';

const createMeasurementWorker = () =>
  new Worker(new URL('./occupiedDepth.worker.ts', import.meta.url), {
    type: 'module',
  });

/** One running measurement and the latest requested slab per mounted view. */
export function useOccupiedDepth(
  request: MaybeRef<OccupiedDepthInput | null>,
  createWorker = createMeasurementWorker
) {
  const accepted = shallowRef<OccupiedDepthResult | null>(null);
  const computing = ref(false);
  const error = ref<string | null>(null);
  let worker: Worker | null = null;
  let active: OccupiedDepthInput | null = null;
  let pending: OccupiedDepthInput | null = null;
  let sequence = 0;
  let sourceValidity: Uint8Array | undefined;
  let hasSource = false;
  let mask: OccupiedDepthInput['mask'] | undefined;

  function release() {
    if (worker) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
    }
    worker?.terminate();
    worker = null;
    active = null;
    hasSource = false;
    sourceValidity = undefined;
    mask = undefined;
    sequence++;
  }

  function fail(message: string) {
    release();
    pending = null;
    accepted.value = null;
    error.value = message;
    computing.value = false;
  }

  function getWorker() {
    if (!worker) {
      worker = createWorker();
      worker.onmessage = receive;
      worker.onerror = (event) =>
        fail(event.message || 'Occupied depth measurement failed.');
      worker.onmessageerror = () =>
        fail('Occupied depth measurement returned unreadable data.');
    }
    return worker;
  }

  function startPending() {
    if (active || !pending) return;
    const input = pending;
    pending = null;
    active = input;
    try {
      const target = getWorker();
      const message: MeasurementRequest = {
        id: ++sequence,
        input: {
          dimensions: [...input.dimensions],
          axis: input.axis,
          first: input.first,
          last: input.last,
        },
      };
      const transfer: Transferable[] = [];
      if (mask !== input.mask) {
        mask = input.mask;
        const values = new Uint8Array(mask.values);
        message.mask = {
          values,
          dimensions: [...mask.dimensions],
          extent: [...mask.extent],
        };
        transfer.push(values.buffer);
      }
      if (!hasSource || sourceValidity !== input.validity) {
        sourceValidity = input.validity;
        hasSource = true;
        const validity = input.validity
          ? new Uint8Array(input.validity)
          : undefined;
        message.source = { validity };
        if (validity) transfer.push(validity.buffer);
      }
      target.postMessage(message, transfer);
    } catch (cause) {
      fail(
        cause instanceof Error
          ? cause.message
          : 'Occupied depth measurement failed.'
      );
    }
  }

  function receive(
    event: MessageEvent<{
      id: number;
      result?: OccupiedDepthResult;
      error?: string;
    }>
  ) {
    if (event.data.id !== sequence) return;
    if (active === unref(request)) {
      accepted.value = event.data.result ?? null;
      error.value = event.data.error ?? null;
      computing.value = false;
    }
    active = null;
    startPending();
  }

  watch(
    () => unref(request),
    (input) => {
      accepted.value = null;
      error.value = null;
      computing.value = !!input;
      pending = input;
      if (!input) release();
      else startPending();
    },
    { immediate: true, flush: 'sync' }
  );
  onScopeDispose(release);
  return { accepted, computing, error };
}
