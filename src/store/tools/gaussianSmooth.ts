import { defineStore } from 'pinia';
import { ref } from 'vue';
import * as Comlink from 'comlink';
import { gaussianSmoothLabelMapWorker } from '@/src/core/tools/paint/gaussianSmooth.worker';
import type { ProcessTarget } from '@/src/store/tools/paintProcess';

export const DEFAULT_SIGMA = 1.0;
export const MIN_SIGMA = 0.1;
export const MAX_SIGMA = 5.0;

// Worker management
type WorkerApi = {
  gaussianSmoothLabelMapWorker: typeof gaussianSmoothLabelMapWorker;
};

let workerInstance: Comlink.Remote<WorkerApi> | null = null;

async function getWorker() {
  if (!workerInstance) {
    // Set up worker with Comlink
    const worker = new Worker(
      new URL(
        '@/src/core/tools/paint/gaussianSmooth.worker.ts',
        import.meta.url
      ),
      { type: 'module' }
    );
    workerInstance = Comlink.wrap<WorkerApi>(worker);
  }
  return workerInstance;
}

async function gaussianSmoothLabelMap(
  target: ProcessTarget,
  params: { sigma: number; label: number }
) {
  const worker = await getWorker();

  const workerInput = {
    data: target.scalars,
    dimensions: target.dimensions,
    spacing: target.spacing,
    maskExtent: target.maskExtent,
    parentDimensions: target.parentDimensions,
    params,
  };

  return worker.gaussianSmoothLabelMapWorker(workerInput);
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
