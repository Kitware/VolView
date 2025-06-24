import { defineStore } from 'pinia';
import { ref } from 'vue';
import { TypedArray } from '@kitware/vtk.js/types';
import * as Comlink from 'comlink';
import vtkLabelMap from '@/src/vtk/LabelMap';
import { gaussianSmoothLabelMapWorker } from '@/src/core/tools/paint/gaussianSmooth.worker';

const DEFAULT_SIGMA = 1.0;
const MIN_SIGMA = 0.1;
const MAX_SIGMA = 5.0;

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
  labelMap: vtkLabelMap,
  params: { sigma: number; label: number }
) {
  const scalars = labelMap.getPointData().getScalars();
  const originalData = scalars.getData();
  const dimensions = labelMap.getDimensions();

  const worker = await getWorker();

  // Transfer data to worker
  const workerInput = {
    data: originalData,
    dimensions,
    params,
  };

  return worker.gaussianSmoothLabelMapWorker(workerInput);
}

export const useGaussianSmoothStore = defineStore('gaussianSmooth', () => {
  const sigma = ref(DEFAULT_SIGMA);

  function setSigma(value: number) {
    sigma.value = Math.max(MIN_SIGMA, Math.min(MAX_SIGMA, value));
  }

  async function computeAlgorithm(
    segImage: vtkLabelMap,
    activeSegment: number
  ): Promise<TypedArray> {
    const params = {
      sigma: sigma.value,
      label: activeSegment,
    };

    return gaussianSmoothLabelMap(segImage, params);
  }

  return {
    sigma,
    setSigma,
    computeAlgorithm,
    // Expose constants for UI
    MIN_SIGMA,
    MAX_SIGMA,
    DEFAULT_SIGMA,
  };
});
