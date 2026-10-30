import { MessageChannel } from 'node:worker_threads';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope } from 'vue';
import * as Comlink from 'comlink';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import { usePiecewiseHistogram } from '@/src/composables/usePiecewiseHistogram';
import { piecewiseHistogram } from '@/src/utils/histogram';
import { defer } from '@/src/utils';

function histogramEndpoint() {
  const { port1, port2 } = new MessageChannel();
  const started = defer<void>();
  const completion = defer<void>();
  const terminated = defer<void>();
  Comlink.expose(
    {
      async piecewiseHistogram(...args: Parameters<typeof piecewiseHistogram>) {
        started.resolve();
        await completion.promise;
        return piecewiseHistogram(...args);
      },
    },
    port2
  );
  port1.start();
  return Object.assign(port1, {
    started: started.promise,
    terminated: terminated.promise,
    async finish(error?: Error) {
      if (error) completion.reject(error);
      else completion.resolve();
      await terminated.promise;
    },
    terminate() {
      port1.close();
      port2.close();
      terminated.resolve();
    },
  });
}

function createImage() {
  const image = vtkImageData.newInstance();
  image.setDimensions([3, 2, 2]);
  image.getPointData().setScalars(
    vtkDataArray.newInstance({
      values: Float32Array.from([0, 1, 1, 2, 2, 2, 3, 3, 3, 3, 4, 4]),
    })
  );
  return image;
}

describe('opacity editor histogram reuse', () => {
  let workers: ReturnType<typeof histogramEndpoint>[];
  let scope: ReturnType<typeof effectScope>;

  beforeEach(() => {
    workers = [];
    scope = effectScope();
    vi.stubGlobal(
      'Worker',
      class {
        constructor() {
          const worker = histogramEndpoint();
          workers.push(worker);
          return worker;
        }
      }
    );
  });

  afterEach(() => {
    scope.stop();
    workers.forEach((worker) => worker.terminate());
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function createEditor() {
    const changes: Array<{ histogram: Float32Array | null; range: number[] }> =
      [];
    const update = scope.run(() =>
      usePiecewiseHistogram({
        getNumberOfBins: () => 5,
        setHistogram: (histogram, range) => changes.push({ histogram, range }),
      })
    )!;
    return { update, changes };
  }

  it('restores completed histograms without clearing the chart or copying volume data again', async () => {
    const image = createImage();
    const { update, changes } = createEditor();
    update(image);
    await workers[0].started;
    await workers[0].finish();
    const ordinary = changes.at(-1);

    update(image, [2, 4]);
    await workers[1].started;
    await workers[1].finish();
    const adaptive = changes.at(-1);
    expect(adaptive?.histogram).not.toEqual(ordinary?.histogram);

    update(image);
    expect(changes.at(-1)).toEqual(ordinary);
    update(image, [2, 4]);
    expect(changes.at(-1)).toEqual(adaptive);
    expect(workers).toHaveLength(2);
    expect(changes.filter(({ histogram }) => !histogram)).toHaveLength(2);
  });

  it('keeps an adaptive histogram calculation across preset changes with identical ranges', async () => {
    const image = createImage();
    const { update, changes } = createEditor();
    update(image, [2, 4]);
    await workers[0].started;
    update(image, [2, 4]);
    expect(workers).toHaveLength(1);
    expect(changes).toHaveLength(1);
    await workers[0].finish();
    expect(changes.at(-1)?.histogram).toEqual(
      piecewiseHistogram([2, 4, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4], [2, 4], 5)
    );
  });

  it('stops a pending image calculation when returning to a cached image', async () => {
    const first = createImage();
    const second = createImage();
    const { update, changes } = createEditor();
    update(first);
    await workers[0].started;
    await workers[0].finish();
    const original = changes.at(-1);

    update(second);
    await workers[1].started;
    update(first);
    await workers[1].terminated;
    await workers[1].finish();
    expect(changes.at(-1)).toEqual(original);

    update(second);
    expect(workers).toHaveLength(3);
    await workers[2].started;
    await workers[2].finish();
    expect(changes.at(-1)).toEqual(original);
  });

  it('retries a failed histogram after another preset without caching the failure', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const image = createImage();
    const { update, changes } = createEditor();
    update(image);
    await workers[0].started;
    await workers[0].finish(new Error('Histogram failed'));
    expect(errors).toHaveBeenCalledOnce();
    expect(changes.at(-1)?.histogram).toBeNull();

    update(image, [2, 4]);
    await workers[1].started;
    await workers[1].finish();
    update(image);
    expect(workers).toHaveLength(3);
    await workers[2].started;
    await workers[2].finish();
    expect(changes.at(-1)?.histogram).toEqual(
      piecewiseHistogram(image.getPointData().getScalars().getData(), [0, 4], 5)
    );
  });

  it('blocks late completion and cached revisits after the editor is disposed', async () => {
    const image = createImage();
    const { update, changes } = createEditor();
    update(image);
    await workers[0].started;
    await workers[0].finish();
    update(image, [2, 4]);
    await workers[1].started;
    const beforeDisposal = changes.length;

    scope.stop();
    await workers[1].terminated;
    await workers[1].finish();
    update(image);
    expect(changes).toHaveLength(beforeDisposal);
    expect(workers).toHaveLength(2);
  });

  it('refreshes the histogram when the underlying volume changes', async () => {
    const image = createImage();
    const { update, changes } = createEditor();
    update(image);
    await workers[0].started;
    await workers[0].finish();
    const original = changes.at(-1)?.histogram;

    const scalars = image.getPointData().getScalars();
    scalars.setComponent(0, 0, 8);
    scalars.modified();
    update(image);
    await workers[1].started;
    await workers[1].finish();
    expect(changes.at(-1)?.range).toEqual([1, 8]);
    expect(changes.at(-1)?.histogram).not.toEqual(original);
  });
});
