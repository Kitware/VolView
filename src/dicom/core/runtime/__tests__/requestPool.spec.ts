import { RequestPool } from '../requestPool';
import { describe, it, expect } from 'vitest';

/** A fetch that never answers and rejects once its request is aborted. */
const abortableFetch = (_input: RequestInfo | URL, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
  });

describe('requestPool', () => {
  it('should not have more active requests than the pool size', () => {
    const N = 4;
    let started = 0;
    const pool = new RequestPool(N, () => {
      started += 1;
      return new Promise<Response>(() => {});
    });
    for (let i = 0; i < 10; i++) {
      pool.fetch('http://localhost/url');
    }
    expect(started).to.equal(N);
  });

  it('should support removal of requests via an AbortController', async () => {
    const N = 4;
    const pool = new RequestPool(N, abortableFetch);
    const controllers: AbortController[] = [];
    const promises: Promise<Response>[] = [];

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

  it('settles queued requests immediately on cancellation or disposal', async () => {
    const fetchStarted = Promise.withResolvers<void>();
    const pool = new RequestPool(
      1,
      (_request, init) =>
        new Promise((_resolve, reject) => {
          fetchStarted.resolve();
          init?.signal?.addEventListener(
            'abort',
            () => reject(init.signal?.reason),
            { once: true }
          );
        })
    );
    const first = pool.fetch('https://example.test/first');
    const firstRejected = expect(first).rejects.toMatchObject({
      name: 'AbortError',
    });
    await fetchStarted.promise;
    const cancellation = new AbortController();
    const second = pool.fetch('https://example.test/second', {
      signal: cancellation.signal,
    });
    const secondRejected = expect(second).rejects.toMatchObject({
      name: 'AbortError',
    });
    cancellation.abort();
    await secondRejected;
    pool.dispose();
    await firstRejected;
    await expect(
      pool.fetch('https://example.test/third')
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it.each(['source', 'pool'])(
    'cancels the HTTP response body after headers through %s disposal',
    async (owner) => {
      const controller = new AbortController();
      const pool = new RequestPool(
        1,
        async (_request, init) =>
          new Response(
            new ReadableStream({
              start(stream) {
                init?.signal?.addEventListener(
                  'abort',
                  () => stream.error(init.signal?.reason),
                  { once: true }
                );
              },
            })
          )
      );
      const response = await pool.fetch('https://example.test/stream', {
        signal: controller.signal,
      });
      const pending = response.body!.getReader().read();
      const rejected = expect(pending).rejects.toMatchObject({
        name: 'AbortError',
      });
      if (owner === 'source') controller.abort();
      else pool.dispose();
      await rejected;
      pool.dispose();
    }
  );
});
