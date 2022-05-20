import vtk from '@kitware/vtk.js/vtk';

import PromiseWorker from '@/src/utils/promise-worker';

export const runAsyncVTKReader = (readerName: string) => async (file: File) => {
  const worker = new PromiseWorker(
    new Worker(new URL('./async.worker.ts', import.meta.url))
  );
  const data = await worker.postMessage({
    file,
    readerName,
  });
  return vtk(data);
};

export const stlReader = runAsyncVTKReader('stl');
export const vtiReader = runAsyncVTKReader('vti');
export const vtpReader = runAsyncVTKReader('vtp');
