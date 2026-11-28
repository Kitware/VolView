import { linkedController, untilAborted } from '../utils';

/** A worker that runs one job at a time; `reset` stops it and rejects that job. */
export type Lane<Job, Result> = Readonly<{
  run: (job: Job) => Promise<Result>;
  reset: (reason: unknown) => void;
}>;

/** Numbered slots handed out first come, first served. */
function createSlots(count: number) {
  const free = Array.from({ length: count }, (_, index) => count - 1 - index);
  const waiters: Array<(index: number) => void> = [];
  const acquire = (signal: AbortSignal) =>
    new Promise<number>((resolve, reject) => {
      if (signal.aborted) {
        reject(signal.reason);
        return;
      }
      if (free.length > 0) {
        resolve(free.pop()!);
        return;
      }
      const onAbort = () => {
        waiters.splice(waiters.indexOf(waiter), 1);
        reject(signal.reason);
      };
      const waiter = (index: number) => {
        signal.removeEventListener('abort', onAbort);
        resolve(index);
      };
      waiters.push(waiter);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  const release = (index: number) => {
    const next = waiters.shift();
    if (next) next(index);
    else free.push(index);
  };
  return { acquire, release };
}

/**
 * Runs jobs on at most `lanes.length` lanes at once, queueing the rest. A
 * running job cannot be interrupted, so aborting it resets its lane.
 * `dispose` settles running and queued jobs.
 */
export function createLanePool<Job, Result>(
  lanes: ReadonlyArray<Lane<Job, Result>>
) {
  const lifetime = new AbortController();
  const slots = createSlots(lanes.length);

  const runOn = async (index: number, job: Job, signal: AbortSignal) => {
    signal.throwIfAborted();
    const lane = lanes[index];
    const stop = () => lane.reset(signal.reason);
    signal.addEventListener('abort', stop, { once: true });
    try {
      return await lane.run(job);
    } finally {
      signal.removeEventListener('abort', stop);
    }
  };

  const run = async (job: Job, signal: AbortSignal) => {
    const { controller, release } = linkedController(signal, lifetime.signal);
    const linked = controller.signal;
    const pooled = async () => {
      const index = await slots.acquire(linked);
      try {
        return await runOn(index, job, linked);
      } finally {
        slots.release(index);
      }
    };
    try {
      return await untilAborted(pooled(), linked);
    } finally {
      release();
    }
  };

  const dispose = (reason: unknown) => {
    lifetime.abort(reason);
    lanes.forEach((lane) => lane.reset(reason));
  };

  return { run, dispose };
}
