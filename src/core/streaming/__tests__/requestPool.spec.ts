import { RequestPool } from '@/src/core/streaming/requestPool';
import { describe, it, expect } from 'vitest';

const neverResolvingFetch = async () => {
  return new Promise<Response>(() => {});
};

const abortableFetch = async (
  _input: RequestInfo | URL,
  init?: RequestInit
) => {
  return new Promise<Response>((_resolve, reject) => {
    if (init?.signal) {
      if (init.signal.aborted) {
        reject(init.signal.reason);
        return;
      }
      init.signal.addEventListener('abort', () => {
        reject(init.signal!.reason);
      });
    }
  });
};

describe('requestPool', () => {
  it('should not have more active requests than the pool size', () => {
    const N = 4;
    const pool = new RequestPool(N, neverResolvingFetch);
    for (let i = 0; i < 10; i++) {
      pool.fetch('http://localhost/url');
    }
    expect(pool.activeConnections).to.equal(N);
  });

  it('should support removal of requests via an AbortController', async () => {
    const N = 4;
    const pool = new RequestPool(N, abortableFetch);
    const controllers: AbortController[] = [];
    const promises: Promise<any>[] = [];

    for (let i = 0; i < 10; i++) {
      const controller = new AbortController();
      controllers.push(controller);
      promises.push(
        pool.fetch('http://localhost/url', { signal: controller.signal })
      );
    }

    controllers.forEach((controller) => {
      controller.abort('cancelled');
    });

    for (const p of promises) {
      await expect(p).rejects.toThrow('cancelled');
    }
  });
});
