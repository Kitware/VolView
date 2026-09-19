import { defineStore } from 'pinia';
import { ref } from 'vue';
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

async function gaussianSmoothLabelMap(
  target: ProcessTarget,
  params: { sigma: number; label: number }
) {
  const workerInput = {
    data: target.scalars,
    dimensions: target.dimensions,
    spacing: target.spacing,
    maskExtent: target.maskExtent,
    parentDimensions: target.parentDimensions,
    params,
  };

  return workerHost.call((worker) =>
    worker.gaussianSmoothLabelMapWorker(workerInput)
  );
}

export const useGaussianSmoothStore = defineStore('gaussianSmooth', () => {
  const sigma = ref(DEFAULT_SIGMA);

  function setSigma(value: number) {
    sigma.value = Math.max(MIN_SIGMA, Math.min(MAX_SIGMA, value));
  }

  async function computeAlgorithm(target: ProcessTarget) {
    const params = {
      sigma: sigma.value,
      label: target.labelValue,
    };

    return gaussianSmoothLabelMap(target, params);
  }

  return {
    sigma,
    setSigma,
    computeAlgorithm,
  };
});
