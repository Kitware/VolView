import * as Comlink from 'comlink';
import type { Lane } from './lanePool';

/**
 * One Comlink worker, created on first use. A worker error rejects the
 * running job and drops the worker, so the next job starts a fresh one.
 */
export function createComlinkLane<Api, Job, Result>(
  createWorker: () => Worker,
  label: string,
  call: (remote: Comlink.Remote<Api>, job: Job) => Promise<Result>
): Lane<Job, Result> {
  let worker: { worker: Worker; remote: Comlink.Remote<Api> } | null = null;
  let rejectActive: ((reason: unknown) => void) | undefined;
  const reset = (reason: unknown) => {
    if (worker) {
      worker.remote[Comlink.releaseProxy]();
      worker.worker.terminate();
      worker = null;
    }
    rejectActive?.(reason);
  };
  const start = () => {
    const created = createWorker();
    created.addEventListener('error', () =>
      reset(new Error(`${label} worker failed`))
    );
    created.addEventListener('messageerror', () =>
      reset(new Error(`${label} worker message failed`))
    );
    worker = { worker: created, remote: Comlink.wrap<Api>(created) };
    return worker;
  };
  const run = async (job: Job) => {
    const failed = new Promise<never>((_, reject) => {
      rejectActive = reject;
    });
    try {
      const { remote } = worker ?? start();
      return await Promise.race([call(remote, job), failed]);
    } finally {
      rejectActive = undefined;
    }
  };
  return { run, reset };
}
