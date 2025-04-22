import { Deferred, defer } from '@/src/utils';

const DEFAULT_POOL_SIZE = 24;

let nextId = 0;
function getNextId() {
  return ++nextId;
}

interface FetchRequest {
  id: number;
  request: RequestInfo | URL;
  init: RequestInit | undefined;
  deferred: Deferred<Response>;
}

/**
 * Fixed-size pool for managing requests.
 *
 * Requests are processed in the order that they are received.
 */
export class RequestPool {
  public readonly poolSize: number;

  private queue: FetchRequest[];
  private inflight: Set<number>;
  private fetchFn: typeof fetch;

  constructor(poolSize = DEFAULT_POOL_SIZE, fetchFn: typeof fetch = fetch) {
    this.poolSize = poolSize;
    this.queue = [];
    this.inflight = new Set();
    this.fetchFn = (input: RequestInfo | URL, init?: RequestInit) =>
      fetchFn(input, init);
  }

  get activeConnections() {
    return this.inflight.size;
  }

  /**
   * Queues up a fetch request.
   *
   * If an AbortSignal is provided and is triggered prior to
   * the request actually starting, it will be removed from the queue.
   * @param requestUrl
   * @param options
   * @returns
   */
  fetch = (request: RequestInfo | URL, init?: RequestInit) => {
    this.pushToQueue({
      request,
      init,
    });
    const { deferred } = this.queue.at(-1)!;

    this.processQueue();
    return deferred.promise;
  };

  /**
   * Adds a fetch request to the internal queue.
   * @param req
   * @returns
   */
  private pushToQueue(req: Omit<FetchRequest, 'id' | 'deferred'>) {
    const id = getNextId();
    const deferred = defer<Response>();
    this.queue.push({ ...req, id, deferred });
    return id;
  }

  /**
   * Begins processing the queue.
   * @returns
   */
  private processQueue() {
    if (this.inflight.size === this.poolSize) return;
    if (this.queue.length === 0) return;
    this.startRequest(this.queue.shift()!);
  }

  /**
   * Acts on a fetch request.
   * @param req
   */
  private async startRequest(req: FetchRequest) {
    const { id, deferred, request, init } = req;

    if (init?.signal?.aborted) {
      deferred.reject(init.signal.reason);
      this.processQueue();
      return;
    }

    this.inflight.add(id);

    try {
      const resp = await this.fetchFn(request, init);
      deferred.resolve(resp);
    } catch (err) {
      deferred.reject(err);
    } finally {
      this.inflight.delete(id);
      // continue processing the queue
      this.processQueue();
    }
  }
}

let currentRequestPool: RequestPool = new RequestPool();

/**
 * Gets the current request pool.
 * @returns
 */
export const getRequestPool = () => currentRequestPool;

/**
 * Sets the current request pool.
 * @param pool
 */
export function setCurrentRequestPool(pool: RequestPool) {
  currentRequestPool = pool;
}
