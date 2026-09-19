import { createProcessWorkerHost } from '@/src/segmentation/editing/processWorker';

// A failed or abandoned worker accepts calls without ever replying.
function silentEndpoint() {
  const listeners = new Map<string, Array<(event: unknown) => void>>();
  const posted: unknown[] = [];
  let terminated = false;

  return {
    posted,
    get terminated() {
      return terminated;
    },
    addEventListener(type: string, listener: (event: unknown) => void) {
      const forType = listeners.get(type) ?? [];
      listeners.set(type, [...forType, listener]);
    },
    removeEventListener(type: string, listener: (event: unknown) => void) {
      const forType = listeners.get(type) ?? [];
      listeners.set(
        type,
        forType.filter((entry) => entry !== listener)
      );
    },
    postMessage(message: unknown) {
      posted.push(message);
    },
    terminate() {
      terminated = true;
    },
    emit(event: { type: string; message?: string }) {
      [...(listeners.get(event.type) ?? [])].forEach((listener) =>
        listener(event)
      );
    },
  };
}

export type SilentApi = { smooth: (value: number) => Promise<number> };

export function hostOverSilentWorkers() {
  const workers: ReturnType<typeof silentEndpoint>[] = [];
  const host = createProcessWorkerHost<SilentApi>(() => {
    const worker = silentEndpoint();
    workers.push(worker);
    return worker as unknown as Worker;
  });
  return { host, workers };
}
