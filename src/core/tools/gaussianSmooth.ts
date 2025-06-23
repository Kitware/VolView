import * as Comlink from 'comlink';
import vtkLabelMap from '@/src/vtk/LabelMap';
import type { GaussianSmoothWorkerApi } from './gaussianSmooth.worker';

export interface GaussianSmoothParams {
  sigma: number;
  label: number;
}

// Create worker instance
let workerInstance: Comlink.Remote<GaussianSmoothWorkerApi> | null = null;

async function getWorker() {
  if (!workerInstance) {
    const worker = new Worker(
      new URL('./gaussianSmooth.worker.ts', import.meta.url),
      { type: 'module' }
    );
    workerInstance = Comlink.wrap<GaussianSmoothWorkerApi>(worker);
  }
  return workerInstance;
}

export async function gaussianSmoothLabelMap(
  labelMap: vtkLabelMap,
  params: GaussianSmoothParams
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
