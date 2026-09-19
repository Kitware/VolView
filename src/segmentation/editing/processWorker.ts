import * as Comlink from 'comlink';

/**
 * A process algorithm's worker, kept warm between runs.
 *
 * Comlink settles a call when the worker posts an answer back, and listens for
 * nothing else. A worker that fails to load its module chunk, or that the
 * browser kills, therefore answers nothing and the call waits forever: the
 * process sits in `computing` with no error to show and no storage rolled
 * back, and every later run reuses the same dead instance. The host watches
 * the worker itself, so a worker that dies takes the calls in flight down with
 * it and is dropped, leaving the next call to start a fresh one.
 */
export type ProcessWorkerHost<Api> = {
  // `Awaited` rather than a `Promise<T>` parameter: a Comlink method whose
  // return type is a union hands back a union of promises, and the result
  // type has to survive that.
  call<T>(use: (api: Comlink.Remote<Api>) => T): Promise<Awaited<T>>;
};

/** What the worker said, or which event ended it when it said nothing. */
function workerFailure(event: Event) {
  const reported = (event as Partial<ErrorEvent>).message;
  return new Error(
    reported || `The worker running this process reported "${event.type}".`
  );
}

export function createProcessWorkerHost<Api>(
  spawn: () => Worker
): ProcessWorkerHost<Api> {
  let proxy: Comlink.Remote<Api> | null = null;
  let died: Promise<never> | null = null;

  function start() {
    const worker = spawn();
    const started = Comlink.wrap<Api>(worker);
    const ended = new Promise<never>((_resolve, reject) => {
      const die = (event: Event) => {
        // Only this worker's own death drops the cache: a later run may
        // already have started a replacement.
        if (proxy === started) {
          proxy = null;
          died = null;
        }
        reject(workerFailure(event));
      };
      worker.addEventListener('error', die);
      worker.addEventListener('messageerror', die);
    });
    // Calls in flight see the rejection through `call`; a worker that dies
    // while idle is not a failure anyone is waiting on.
    ended.catch(() => undefined);
    proxy = started;
    died = ended;
  }

  async function call<T>(
    use: (api: Comlink.Remote<Api>) => T
  ): Promise<Awaited<T>> {
    if (!proxy || !died) start();
    return Promise.race([use(proxy!), died!]) as Promise<Awaited<T>>;
  }

  return { call };
}
