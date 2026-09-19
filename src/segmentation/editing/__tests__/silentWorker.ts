import { createProcessWorkerHost } from '@/src/segmentation/editing/processWorker';

/**
 * A Comlink endpoint that accepts messages and never answers one, which is
 * what a worker that failed to load, or that is busy with a job nobody wants
 * any more, looks like from the page.
 */
export class SilentWorker {
  static created: SilentWorker[] = [];

  private listeners = new Map<string, Array<(event: unknown) => void>>();

  posted: unknown[] = [];

  terminated = false;

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

  terminate() {
    this.terminated = true;
  }

  /** What the browser does to a worker that fails: an event, no reply. */
  emit(event: { type: string; message?: string }) {
    [...(this.listeners.get(event.type) ?? [])].forEach((listener) =>
      listener(event)
    );
  }
}

export type SilentApi = { smooth: (value: number) => Promise<number> };

/** A host over silent workers, and the workers it has started so far. */
export function hostOverSilentWorkers() {
  SilentWorker.created = [];
  const host = createProcessWorkerHost<SilentApi>(
    () => new SilentWorker() as unknown as Worker
  );
  return { host, workers: SilentWorker.created };
}
