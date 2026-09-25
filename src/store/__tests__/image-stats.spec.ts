import { MessageChannel } from 'node:worker_threads';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, disposePinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import { flushPromises } from '@vue/test-utils';
import { defer } from '@/src/utils';
import * as Comlink from 'comlink';
import { histogram } from '@/src/utils/histogram';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useImageStatsStore } from '@/src/store/image-stats';
import { messageTitles } from '@/src/components/__tests__/messageDisplay';
import { seatImage } from '@/src/segmentation/__tests__/segmentMaskFixtures';

// Real Comlink messages and histogram results, with completion controlled at
// the browser Worker boundary because the unit environment has no Workers.
class HistogramEndpoint {
  channel = new MessageChannel();

  postMessage = this.channel.port1.postMessage.bind(this.channel.port1);

  addEventListener = this.channel.port1.addEventListener.bind(
    this.channel.port1
  );

  removeEventListener = this.channel.port1.removeEventListener.bind(
    this.channel.port1
  );

  finish!: (error?: Error) => void;

  started = defer<void>();

  terminated = defer<void>();

  terminate = vi.fn(() => {
    this.channel.port1.close();
    this.channel.port2.close();
    this.terminated.resolve();
  });

  constructor() {
    const completion = new Promise<void>((resolve, reject) => {
      this.finish = (error) => (error ? reject(error) : resolve());
    });
    Comlink.expose(
      {
        histogram: async (...args: Parameters<typeof histogram>) => {
          this.started.resolve();
          await completion;
          return histogram(...args);
        },
      },
      this.channel.port2
    );
    this.channel.port1.start();
  }
}

describe('image statistics worker ownership', () => {
  let pinia: ReturnType<typeof createPinia>;
  let workers: HistogramEndpoint[];

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    workers = [];
    vi.stubGlobal(
      'Worker',
      class extends HistogramEndpoint {
        constructor() {
          super();
          workers.push(this);
        }
      }
    );
    useImageStatsStore();
  });

  afterEach(async () => {
    const cache = useImageCacheStore();
    [...cache.imageIds].forEach(cache.removeImage);
    await nextTick();
    workers.forEach((worker) => worker.terminate());
    disposePinia(pinia);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function startImage(id: string, offset = 0) {
    await seatImage(id, {
      dimensions: [8, 8, 16],
      values: Int16Array.from(
        { length: 1024 },
        (_, index) => (index % 512) + offset
      ),
    });
    const worker = workers[workers.length - 1];
    await worker.started.promise;
    return worker;
  }

  const finish = async (worker: HistogramEndpoint, error?: Error) => {
    worker.finish(error);
    await worker.terminated.promise;
    await flushPromises();
  };

  function expectRanges(id: string, offset = 0) {
    expect(useImageStatsStore().getAutoRangeValues(id)).toEqual({
      FullRange: [offset, offset + 511],
      LowContrast: [offset + 5, offset + 507],
      MediumContrast: [offset + 10, offset + 502],
      HighContrast: [offset + 25, offset + 487],
    });
  }

  it('reclaims each completed worker and preserves repeated auto ranges', async () => {
    for (let cycle = 0; cycle < 4; cycle++) {
      const id = `image-${cycle}`;
      const worker = await startImage(id, cycle * 100 - 300);
      expect(worker.terminate).not.toHaveBeenCalled();
      await finish(worker);
      expectRanges(id, cycle * 100 - 300);
      expect(worker.terminate).toHaveBeenCalledExactlyOnceWith();
      useImageCacheStore().removeImage(id);
      await nextTick();
      expect(useImageStatsStore().stats[id]).toBeUndefined();
    }
    expect(messageTitles()).toEqual([]);
  });

  it('reclaims a rejected worker while other calculations and later loads succeed', async () => {
    const failed = await startImage('failed');
    const healthy = await startImage('healthy', -1000);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

    await finish(failed, new Error('Histogram failed'));
    expect(messageTitles()).toEqual([
      'Auto range computation failed for image failed',
    ]);
    expect(errors).toHaveBeenCalled();
    expect(failed.terminate).toHaveBeenCalledExactlyOnceWith();
    expect(healthy.terminate).not.toHaveBeenCalled();
    expect(useImageStatsStore().getAutoRangeValues('failed')).toEqual({});

    await finish(healthy);
    expectRanges('healthy', -1000);
    expect(healthy.terminate).toHaveBeenCalledExactlyOnceWith();
    const later = await startImage('later', 1000);
    await finish(later);
    expectRanges('later', 1000);
    expect(later.terminate).toHaveBeenCalledExactlyOnceWith();
  });

  it('finishes a removed image without restoring statistics or stopping a peer', async () => {
    const removed = await startImage('removed');
    const healthy = await startImage('healthy');
    useImageCacheStore().removeImage('removed');
    await nextTick();
    await finish(removed);
    expect(removed.terminate).toHaveBeenCalledExactlyOnceWith();
    expect(useImageStatsStore().stats.removed).toBeUndefined();
    expect(healthy.terminate).not.toHaveBeenCalled();
    await finish(healthy);
    expectRanges('healthy');
    expect(healthy.terminate).toHaveBeenCalledExactlyOnceWith();
    expect(messageTitles()).toEqual([]);
  });
});
