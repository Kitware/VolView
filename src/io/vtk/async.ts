import vtk from '@kitware/vtk.js/vtk';

import PromiseWorker from '@/src/utils/promise-worker';

interface SuccessResult {
  status: 'success';
  obj: object;
}

interface FailResult {
  status: 'fail';
  error: Error;
}

type Result = SuccessResult | FailResult;

export const runAsyncVTKReader = (readerName: string) => async (file: File) => {
  const worker = new PromiseWorker(
    new Worker(new URL('./async.worker.ts', import.meta.url))
  );
  const data = (await worker.postMessage({
    file,
    readerName,
  })) as Result;
  if (data.status === 'success') {
    return vtk(data.obj);
  }
  throw data.error;
};

export const stlReader = runAsyncVTKReader('stl');
export const vtiReader = runAsyncVTKReader('vti');
export const vtpReader = runAsyncVTKReader('vtp');
