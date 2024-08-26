import { Deferred, addEventListenerOnce, defer } from '@/src/utils';

const DEFAULT_POOL_SIZE = 60;

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

  constructor(poolSize = DEFAULT_POOL_SIZE) {
    this.poolSize = poolSize;
    this.queue = [];
    this.inflight = new Set();
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
    const id = this.pushToQueue({
      request,
      init,
    });
    const { deferred } = this.queue.at(-1)!;

    if (init?.signal) {
      addEventListenerOnce(init.signal, 'abort', () => {
        const idx = this.queue.findIndex((req) => req.id === id);
        if (idx > -1) this.queue.splice(idx, 1);
      });
    }

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
    this.inflight.add(id);

    try {
      const resp = await fetch(request, init);
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
