import { RequestPool } from '@/src/core/streaming/requestPool';
import { addEventListenerOnce } from '@/src/utils';
import { describe, it } from 'vitest';
import chaiAsPromised from 'chai-as-promised';
import chai, { expect } from 'chai';

chai.use(chaiAsPromised);

// @ts-ignore
global.fetch = async (request: RequestInfo | URL, init?: RequestInit) => {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, 100);
    if (init?.signal) {
      addEventListenerOnce(init.signal, 'abort', (reason) => {
        clearTimeout(timeout);
        reject(reason ?? new Error('cancelled timeout'));
      });
    }
  });
};

describe('requestPool', () => {
  it('should not have more active requests than the pool size', () => {
    const N = 4;
    const pool = new RequestPool(N);
    for (let i = 0; i < 10; i++) {
      pool.fetch('url');
    }
    expect(pool.activeConnections).to.equal(N);
  });

  it('should support removal of requests via an AbortController', () => {
    const N = 4;
    const pool = new RequestPool(N);
    const controllers: AbortController[] = [];
    const promises: Promise<any>[] = [];

    for (let i = 0; i < 10; i++) {
      const controller = new AbortController();
      controllers.push(controller);
      promises.push(pool.fetch('url', { signal: controller.signal }));
    }

    controllers.forEach((controller) => {
      controller.abort();
    });

    promises.forEach((promise) => {
      expect(promise).to.be.rejected;
    });
  });
});
