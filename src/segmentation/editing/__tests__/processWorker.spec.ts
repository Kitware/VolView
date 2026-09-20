import { describe, expect, it } from 'vitest';
import { terminateProcessWorkers } from '@/src/segmentation/editing/processWorker';
import { hostOverSilentWorkers } from '@/src/segmentation/editing/__tests__/silentWorker';

// ---------------------------------------------------------------------------
// A process worker that dies, and one a cancelled run walks away from. Comlink
// answers a call only when the worker posts a reply, so a worker that fails to
// load its module chunk, or that the browser kills, leaves the call waiting
// forever: the process stays in `computing`, nothing is rolled back, and the
// cached instance poisons every later run. A job already posted cannot be
// called back either, so a cancelled run's work would keep the worker busy.
// ---------------------------------------------------------------------------

describe('a process worker host', () => {
  it('reuses one worker across calls', async () => {
    const { host, workers } = hostOverSilentWorkers();

    // Discarded results get a catch: a call the host later ends rejects, and
    // a promise nobody holds would report that as unhandled.
    host.call((api) => api.smooth(1)).catch(() => undefined);
    host.call((api) => api.smooth(2)).catch(() => undefined);

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

    host.call((api) => api.smooth(2)).catch(() => undefined);

    // The dead instance is dropped, so the next run is not answered by it.
    expect(workers).toHaveLength(2);
  });

  it('ends the calls in flight when the host is terminated', async () => {
    const { host, workers } = hostOverSilentWorkers();

    const call = host.call((api) => api.smooth(1));
    host.terminate();

    await expect(call).rejects.toThrow(/stopped/);
    expect(workers[0].terminated).toBe(true);
  });

  it('starts a fresh worker for the run after a terminate', async () => {
    const { host, workers } = hostOverSilentWorkers();

    host.call((api) => api.smooth(1)).catch(() => undefined);
    terminateProcessWorkers();
    host.call((api) => api.smooth(2)).catch(() => undefined);

    expect(workers[0].terminated).toBe(true);
    expect(workers).toHaveLength(2);
    expect(workers[1].terminated).toBe(false);
  });
});
