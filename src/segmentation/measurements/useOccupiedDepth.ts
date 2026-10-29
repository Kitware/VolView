import {
  computed,
  onScopeDispose,
  ref,
  shallowRef,
  unref,
  watch,
  type MaybeRef,
} from 'vue';
import type { OccupiedDepthInput, OccupiedDepthResult } from './occupiedDepth';
import type {
  MeasurementRequest,
  MeasurementResponse,
} from './occupiedDepthHandler';

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

const createMeasurementWorker = () =>
  new Worker(new URL('./occupiedDepth.worker.ts', import.meta.url), {
    type: 'module',
  });

/** One running measurement and the latest requested slab per mounted view. */
export function useOccupiedDepth(
  request: MaybeRef<OccupiedDepthRequest | null>,
  createWorker = createMeasurementWorker,
  enabled: MaybeRef<boolean> = computed(() => !!unref(request))
) {
  const result = shallowRef<OccupiedDepthResult | null>(null);
  const computing = ref(false);
  const error = ref<string | null>(null);
  let worker: Worker | null = null;
  let active: OccupiedDepthRequest | null = null;
  let pending: OccupiedDepthRequest | null = null;
  let sequence = 0;
  const acceptedRequest = shallowRef<OccupiedDepthRequest | null>(null);
  let sourceValidity: OccupiedDepthInput['validity'];
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
    acceptedRequest.value = null;
    mask = undefined;
    sequence++;
  }

  function fail(message: string) {
    release();
    pending = null;
    result.value = null;
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
          ? {
              values: new Uint8Array(input.validity.values),
              extent: [...input.validity.extent],
            }
          : undefined;
        message.source = { validity };
        if (validity) transfer.push(validity.values.buffer);
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

  function receive(event: MessageEvent<MeasurementResponse>) {
    if (event.data.id !== sequence) return;
    if (active === unref(request)) {
      result.value = event.data.result ?? null;
      acceptedRequest.value = event.data.result ? active : null;
      error.value = event.data.error ?? null;
      computing.value = false;
    }
    active = null;
    startPending();
  }

  watch(
    [() => unref(request), () => unref(enabled)],
    ([input, isEnabled]) => {
      if (
        !isEnabled ||
        !input ||
        !acceptedRequest.value ||
        !compatible(acceptedRequest.value, input)
      ) {
        result.value = null;
        acceptedRequest.value = null;
      }
      error.value = null;
      computing.value = isEnabled && !!input;
      pending = isEnabled ? input : null;
      if (!isEnabled) release();
      else startPending();
    },
    { immediate: true, flush: 'pre' }
  );
  onScopeDispose(release);
  const accepted = computed(() => {
    const input = unref(request);
    return unref(enabled) &&
      input &&
      acceptedRequest.value &&
      compatible(acceptedRequest.value, input)
      ? result.value
      : null;
  });
  const stale = computed(() => computing.value && !!accepted.value);
  return { accepted, computing, error, stale };
}
