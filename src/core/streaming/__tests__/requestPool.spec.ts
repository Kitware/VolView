import { RequestPool } from '@/src/core/streaming/requestPool';
import { describe, it, expect } from 'vitest';

// @ts-ignore
const fetch = async () => {
  return new Promise<Response>(() => {});
};

describe('requestPool', () => {
  it('should not have more active requests than the pool size', () => {
    const N = 4;
    const pool = new RequestPool(N, fetch);
    for (let i = 0; i < 10; i++) {
      pool.fetch('http://localhost/url');
    }
    expect(pool.activeConnections).to.equal(N);
  });

  it('should support removal of requests via an AbortController', async () => {
    const N = 4;
    const pool = new RequestPool(N);
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

    // eslint-disable-next-line no-restricted-syntax
    for (const p of promises) {
      // eslint-disable-next-line no-await-in-loop
      await expect(p).rejects.toThrow('cancelled');
    }
  });
});
