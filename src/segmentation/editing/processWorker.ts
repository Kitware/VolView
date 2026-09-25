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
  // Rejects when the worker dies mid-call, so a caller has to await or catch.
  call<T>(use: (api: Comlink.Remote<Api>) => T): Promise<Awaited<T>>;
  /** Drop the worker, ending the calls in flight. */
  terminate(): void;
};

/** Every host built here, so a cancelled run can drop the lot. */
const hosts = new Set<{ terminate: () => void }>();

/**
 * Ends every process worker. A job already posted to a worker cannot be
 * called back: the worker runs it to the end and only then takes the next one.
 * A cancelled run's jobs would therefore keep the worker busy with results
 * nobody wants, and the run replacing them would wait behind that work.
 */
export function terminateProcessWorkers() {
  hosts.forEach((host) => host.terminate());
}

function workerFailure(event: Event) {
  const reported = (event as Partial<ErrorEvent>).message;
  return new Error(
    reported || `The worker running this process reported "${event.type}".`
  );
}

export function createProcessWorkerHost<Api>(
  spawn: () => Worker
): ProcessWorkerHost<Api> {
  let live: {
    proxy: Comlink.Remote<Api>;
    died: Promise<never>;
    discard: (reason: Error) => void;
  } | null = null;

  function start() {
    const worker = spawn();
    const proxy = Comlink.wrap<Api>(worker);
    let end: (reason: Error) => void = () => {};
    const died = new Promise<never>((_resolve, reject) => {
      end = reject;
    });
    const discard = (reason: Error) => {
      // Only this worker's own end drops the cache: a later run may already
      // have started its replacement.
      if (live?.proxy === proxy) live = null;
      worker.terminate();
      end(reason);
    };
    const die = (event: Event) => discard(workerFailure(event));
    worker.addEventListener('error', die);
    worker.addEventListener('messageerror', die);
    // Calls in flight see the rejection through `call`; a worker dropped with
    // nothing running is not a failure anyone is waiting on.
    died.catch(() => undefined);
    live = { proxy, died, discard };
    return live;
  }

  async function call<T>(
    use: (api: Comlink.Remote<Api>) => T
  ): Promise<Awaited<T>> {
    const instance = live ?? start();
    return Promise.race([use(instance.proxy), instance.died]) as Promise<
      Awaited<T>
    >;
  }

  const host = {
    call,
    terminate: () =>
      live?.discard(new Error('The process worker was stopped.')),
  };
  hosts.add(host);
  return host;
}
