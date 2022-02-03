import vtk from '@kitware/vtk.js/vtk';

import PromiseWorker from '@/src/utils/promiseWorker';
import AsyncReaderWorker from './async.worker';

export async function VtkStlReader(file) {
  const worker = new PromiseWorker(AsyncReaderWorker);
  const data = await worker.postMessage({
    file,
    readerName: 'stl',
  });
  return vtk(data);
}

export default {};
