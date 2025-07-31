import { defineStore } from 'pinia';
import { ref } from 'vue';
import * as Comlink from 'comlink';
import vtkLabelMap from '@/src/vtk/LabelMap';
import { gaussianSmoothLabelMapWorker } from '@/src/core/tools/paint/gaussianSmooth.worker';

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
  labelMap: vtkLabelMap,
  params: { sigma: number; label: number }
) {
  const scalars = labelMap.getPointData().getScalars();
  const originalData = scalars.getData();
  const dimensions = labelMap.getDimensions();
  const spacing = labelMap.getSpacing() as [number, number, number];

  const worker = await getWorker();

  const workerInput = {
    data: originalData,
    dimensions,
    spacing,
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
  ) {
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
  };
});
