import { abortError } from '../utils';

type FetchRequest = {
  request: RequestInfo | URL;
  init?: RequestInit;
  resolve: (response: Response) => void;
  reject: (reason?: unknown) => void;
  controller: AbortController;
  cleanup: () => void;
};

/** A FIFO request pool. Disposal aborts active fetches and rejects queued callers. */
export class RequestPool {
  private queue: FetchRequest[] = [];
  private inflight = new Set<FetchRequest>();
  private lifetime = new AbortController();

  constructor(
    public readonly poolSize = 24,
    private fetchFn: typeof fetch = (input, init) =>
      globalThis.fetch(input, init)
  ) {
    if (!Number.isInteger(poolSize) || poolSize < 1)
      throw new Error('Request concurrency must be a positive integer');
  }

  fetch = (request: RequestInfo | URL, init?: RequestInit) => {
    const disposal = this.lifetime.signal;
    if (disposal.aborted) return Promise.reject(disposal.reason);
    // Promise.withResolvers is newer than the browsers the app supports.
    let resolve!: FetchRequest['resolve'];
    let reject!: FetchRequest['reject'];
    const response = new Promise<Response>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const controller = new AbortController();
    const sourceSignal =
      init?.signal ?? (request instanceof Request ? request.signal : undefined);
    const abort = () => {
      controller.abort(sourceSignal?.reason);
      reject(sourceSignal?.reason);
      this.queue = this.queue.filter((entry) => entry !== queued);
    };
    const onDispose = () => {
      controller.abort(disposal.reason);
      reject(disposal.reason);
    };
    const queued: FetchRequest = {
      request,
      init,
      resolve,
      reject,
      controller,
      cleanup: () => {
        sourceSignal?.removeEventListener('abort', abort);
        disposal.removeEventListener('abort', onDispose);
      },
    };
    if (sourceSignal?.aborted) {
      reject(sourceSignal.reason);
      return response;
    }
    sourceSignal?.addEventListener('abort', abort, { once: true });
    disposal.addEventListener('abort', onDispose, { once: true });
    controller.signal.addEventListener('abort', queued.cleanup, { once: true });
    this.queue.push(queued);
    this.processQueue();
    return response;
  };

  dispose(reason: unknown = abortError('Request pool disposed')) {
    this.lifetime.abort(reason);
    this.queue = [];
  }

  private processQueue() {
    while (
      !this.lifetime.signal.aborted &&
      this.inflight.size < this.poolSize &&
      this.queue.length
    ) {
      this.startRequest(this.queue.shift()!);
    }
  }

  private async startRequest(request: FetchRequest) {
    this.inflight.add(request);
    try {
      const fetchFn = this.fetchFn;
      const response = await fetchFn(request.request, {
        ...request.init,
        signal: request.controller.signal,
      });
      if (request.controller.signal.aborted) {
        response.body?.cancel().catch(() => {});
        request.reject(request.controller.signal.reason);
      } else request.resolve(response);
    } catch (error) {
      request.cleanup();
      request.reject(error);
    } finally {
      this.inflight.delete(request);
      this.processQueue();
    }
  }
}
