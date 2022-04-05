import vtk from '@kitware/vtk.js/vtk';

import PromiseWorker from '@/src/utils/promise-worker';
// eslint-disable-next-line import/extensions
import AsyncReaderWorker from './async.worker.ts';

export const runAsyncVTKReader = (readerName: string) => async (file: File) => {
  const worker = new PromiseWorker(AsyncReaderWorker);
  const data = await worker.postMessage({
    file,
    readerName,
  });
  return vtk(data);
};

export const stlReader = runAsyncVTKReader('stl');
export const vtiReader = runAsyncVTKReader('vti');
export const vtpReader = runAsyncVTKReader('vtp');
