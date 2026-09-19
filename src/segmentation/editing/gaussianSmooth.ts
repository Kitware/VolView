import { defineStore } from 'pinia';
import { ref } from 'vue';
import * as Comlink from 'comlink';
import { gaussianSmoothLabelMapWorker } from '@/src/segmentation/editing/algorithms/gaussianSmooth.worker';
import type { ProcessTarget } from '@/src/segmentation/editing/paintProcess';
import { createProcessWorkerHost } from '@/src/segmentation/editing/processWorker';

export const DEFAULT_SIGMA = 1.0;
export const MIN_SIGMA = 0.1;
export const MAX_SIGMA = 5.0;

// Worker management
type WorkerApi = {
  gaussianSmoothLabelMapWorker: typeof gaussianSmoothLabelMapWorker;
};

const workerHost = createProcessWorkerHost<WorkerApi>(
  () =>
    new Worker(
      new URL(
        '@/src/segmentation/editing/algorithms/gaussianSmooth.worker.ts',
        import.meta.url
      ),
      { type: 'module' }
    )
);

export const useGaussianSmoothStore = defineStore('gaussianSmooth', () => {
  const sigma = ref(DEFAULT_SIGMA);

  function setSigma(value: number) {
    sigma.value = Math.max(MIN_SIGMA, Math.min(MAX_SIGMA, value));
  }

  async function computeAlgorithm(target: ProcessTarget) {
    const input = {
      data: target.scalars,
      dimensions: target.dimensions,
      spacing: target.spacing,
      maskExtent: target.maskExtent,
      parentDimensions: target.parentDimensions,
      params: { sigma: sigma.value },
    };
    // The detached input is not read again, so move it rather than clone it.
    return workerHost.call((worker) =>
      worker.gaussianSmoothLabelMapWorker(
        Comlink.transfer(input, [target.scalars.buffer as ArrayBuffer])
      )
    );
  }

  return {
    sigma,
    setSigma,
    computeAlgorithm,
  };
});
