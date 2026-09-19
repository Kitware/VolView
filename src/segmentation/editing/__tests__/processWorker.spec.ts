import { describe, expect, it } from 'vitest';
import { terminateProcessWorkers } from '@/src/segmentation/editing/processWorker';
import { hostOverSilentWorkers } from '@/src/segmentation/editing/__tests__/silentWorker';

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

  it('keeps separate hosts and their endpoints independent', async () => {
    const first = hostOverSilentWorkers();
    const second = hostOverSilentWorkers();
    const firstCall = first.host.call((api) => api.smooth(1));
    const secondCall = second.host.call((api) => api.smooth(2));

    expect(first.workers).toHaveLength(1);
    expect(second.workers).toHaveLength(1);
    first.host.terminate();
    await expect(firstCall).rejects.toThrow();
    expect(first.workers[0].terminated).toBe(true);
    expect(second.workers[0].terminated).toBe(false);

    second.host.terminate();
    await expect(secondCall).rejects.toThrow();
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
