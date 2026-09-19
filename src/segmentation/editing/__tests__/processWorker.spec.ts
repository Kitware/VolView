import { describe, expect, it } from 'vitest';
import { createProcessWorkerHost } from '@/src/segmentation/editing/processWorker';

// ---------------------------------------------------------------------------
// A process worker that dies. Comlink answers a call only when the worker
// posts a reply, so a worker that fails to load its module chunk, or that the
// browser kills, leaves the call waiting forever: the process stays in
// `computing`, nothing is rolled back, and the cached instance poisons every
// later run. The host below is what turns that silence into a rejection.
// ---------------------------------------------------------------------------

/** A Comlink endpoint that accepts messages and never answers one. */
class SilentWorker {
  static created: SilentWorker[] = [];

  private listeners = new Map<string, Array<(event: unknown) => void>>();

  posted: unknown[] = [];

  constructor() {
    SilentWorker.created.push(this);
  }

  addEventListener(type: string, listener: (event: unknown) => void) {
    const forType = this.listeners.get(type) ?? [];
    forType.push(listener);
    this.listeners.set(type, forType);
  }

  removeEventListener(type: string, listener: (event: unknown) => void) {
    const forType = this.listeners.get(type) ?? [];
    this.listeners.set(
      type,
      forType.filter((entry) => entry !== listener)
    );
  }

  postMessage(message: unknown) {
    this.posted.push(message);
  }

  /** What the browser does to a worker that fails: an event, no reply. */
  emit(event: { type: string; message?: string }) {
    [...(this.listeners.get(event.type) ?? [])].forEach((listener) =>
      listener(event)
    );
  }
}

type Api = { smooth: (value: number) => Promise<number> };

function hostOverSilentWorkers() {
  SilentWorker.created = [];
  const host = createProcessWorkerHost<Api>(
    () => new SilentWorker() as unknown as Worker
  );
  return {
    host,
    workers: SilentWorker.created,
  };
}

describe('a process worker host', () => {
  it('reuses one worker across calls', async () => {
    const { host, workers } = hostOverSilentWorkers();

    host.call((api) => api.smooth(1));
    host.call((api) => api.smooth(2));

    expect(workers).toHaveLength(1);
    // Both calls reached the same endpoint rather than being dropped.
    await Promise.resolve();
    expect(workers[0].posted.length).toBeGreaterThanOrEqual(2);
  });

  it('rejects the calls in flight when the worker errors', async () => {
    const { host, workers } = hostOverSilentWorkers();

    const first = host.call((api) => api.smooth(1));
    const second = host.call((api) => api.smooth(2));
    workers[0].emit({ type: 'error', message: 'Failed to load worker chunk' });

    await expect(first).rejects.toThrow('Failed to load worker chunk');
    await expect(second).rejects.toThrow('Failed to load worker chunk');
  });

  it('names the event when the failure carries no message', async () => {
    const { host, workers } = hostOverSilentWorkers();

    const call = host.call((api) => api.smooth(1));
    workers[0].emit({ type: 'messageerror' });

    await expect(call).rejects.toThrow(/messageerror/);
  });

  it('starts a fresh worker for the call after a failure', async () => {
    const { host, workers } = hostOverSilentWorkers();

    const call = host.call((api) => api.smooth(1));
    workers[0].emit({ type: 'error', message: 'worker gone' });
    await expect(call).rejects.toThrow('worker gone');

    host.call((api) => api.smooth(2));

    // The dead instance is dropped, so the next run is not answered by it.
    expect(workers).toHaveLength(2);
  });
});
