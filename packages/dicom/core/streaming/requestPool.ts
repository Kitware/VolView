import { Deferred, defer } from '../utils';

type FetchRequest = {
  request: RequestInfo | URL;
  init?: RequestInit;
  deferred: Deferred<Response>;
  controller: AbortController;
  cleanup: () => void;
};

/** A FIFO request pool. Disposal aborts active fetches and rejects queued callers. */
export class RequestPool {
  private queue: FetchRequest[] = [];
  private inflight = new Set<FetchRequest>();
  private disposed = false;
  private lifetime = new AbortController();

  constructor(
    public readonly poolSize = 24,
    private fetchFn: typeof fetch = (input, init) =>
      globalThis.fetch(input, init)
  ) {
    if (!Number.isInteger(poolSize) || poolSize < 1)
      throw new Error('Request concurrency must be a positive integer');
  }

  get activeConnections() {
    return this.inflight.size;
  }

  fetch = (request: RequestInfo | URL, init?: RequestInit) => {
    if (this.disposed)
      return Promise.reject(
        new DOMException('Request pool disposed', 'AbortError')
      );
    const deferred = defer<Response>();
    const controller = new AbortController();
    const sourceSignal =
      init?.signal ?? (request instanceof Request ? request.signal : undefined);
    const abort = () => {
      controller.abort(sourceSignal?.reason);
      deferred.reject(sourceSignal?.reason);
      this.queue = this.queue.filter((entry) => entry !== queued);
    };
    const queued: FetchRequest = {
      request,
      init,
      deferred,
      controller,
      cleanup: () => sourceSignal?.removeEventListener('abort', abort),
    };
    if (sourceSignal?.aborted) {
      deferred.reject(sourceSignal.reason);
      return deferred.promise;
    }
    sourceSignal?.addEventListener('abort', abort, { once: true });
    this.queue.push(queued);
    this.processQueue();
    return deferred.promise;
  };

  dispose() {
    this.disposed = true;
    const error = new DOMException('Request pool disposed', 'AbortError');
    this.lifetime.abort(error);
    [...this.queue, ...this.inflight].forEach((request) => {
      request.controller.abort(error);
      request.deferred.reject(error);
      request.cleanup();
    });
    this.queue = [];
  }

  private processQueue() {
    while (
      !this.disposed &&
      this.inflight.size < this.poolSize &&
      this.queue.length
    ) {
      this.startRequest(this.queue.shift()!);
    }
  }

  private async startRequest(request: FetchRequest) {
    this.inflight.add(request);
    try {
      const sourceSignal =
        request.init?.signal ??
        (request.request instanceof Request
          ? request.request.signal
          : undefined);
      const signals = [request.controller.signal, this.lifetime.signal];
      if (sourceSignal) signals.push(sourceSignal);
      const fetchFn = this.fetchFn;
      const response = await fetchFn(request.request, {
        ...request.init,
        signal: AbortSignal.any(signals),
      });
      if (request.controller.signal.aborted) {
        response.body?.cancel().catch(() => {});
        request.deferred.reject(request.controller.signal.reason);
      } else request.deferred.resolve(response);
    } catch (error) {
      request.deferred.reject(error);
    } finally {
      request.cleanup();
      this.inflight.delete(request);
      this.processQueue();
    }
  }
}
