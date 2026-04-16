import vtk from '@kitware/vtk.js/vtk';

import PromiseWorker from '@/src/utils/promise-worker';
import vtkDataSet from '@kitware/vtk.js/Common/DataModel/DataSet';
import { vtkObject } from '@kitware/vtk.js/interfaces';
import { StateObject } from './common';

// VTK.js DataArray.getState() calls Array.from() on typed arrays,
// which OOMs for large images (>~180M voxels). This helper temporarily
// swaps each array's data with empty before getState(), then injects
// the original TypedArrays into the resulting state. Structured clone
// (postMessage) handles TypedArrays efficiently, and vtk()
// reconstruction accepts them in DataArray.extend().
const getStateWithTypedArrays = (dataSet: vtkDataSet) => {
  const pointData = (dataSet as any).getPointData?.();
  const arrays: any[] = pointData?.getArrays?.() ?? [];

  const typedArrays = arrays.map((arr: any) => arr.getData());

  // Swap to empty so Array.from runs on [] instead of huge TypedArray
  arrays.forEach((arr: any) => arr.setData(new Uint8Array(0)));

  let state: any;
  try {
    state = dataSet.getState();
  } finally {
    arrays.forEach((arr: any, i: number) => arr.setData(typedArrays[i]));
  }

  // Inject original TypedArrays into the serialized state
  state?.pointData?.arrays?.forEach((entry: any, i: number) => {
    if (entry?.data) {
      entry.data.values = typedArrays[i];
      entry.data.size = typedArrays[i].length;
    }
  });

  return state;
};

interface SuccessReadResult {
  status: 'success';
  obj: StateObject;
}

interface FailResult {
  status: 'fail';
  error: Error;
}

type ReadResult = SuccessReadResult | FailResult;

export const runAsyncVTKReader = (readerName: string) => async (file: File) => {
  const asyncWorker = new Worker(
    new URL('./async.reader.worker.ts', import.meta.url),
    {
      type: 'module',
    }
  );
  const worker = new PromiseWorker(asyncWorker);
  const data = (await worker.postMessage({
    file,
    readerName,
  })) as ReadResult;
  asyncWorker.terminate();
  if (data.status === 'success') {
    return vtk(data.obj) as vtkObject;
  }
  throw data.error;
};

interface SuccessWriteResult {
  status: 'success';
  data: string;
}
type WriteResult = SuccessWriteResult | FailResult;

export const runAsyncVTKWriter =
  (writerName: string) => async (dataSet: vtkDataSet) => {
    const asyncWorker = new Worker(
      new URL('./async.writer.worker.ts', import.meta.url),
      {
        type: 'module',
      }
    );
    const worker = new PromiseWorker(asyncWorker);
    const result = (await worker.postMessage({
      obj: getStateWithTypedArrays(dataSet),
      writerName,
    })) as WriteResult;
    asyncWorker.terminate();
    if (result.status === 'success') {
      return result.data;
    }
    throw result.error;
  };

export const stlReader = runAsyncVTKReader('stl');
export const vtiReader = runAsyncVTKReader('vti');
export const vtpReader = runAsyncVTKReader('vtp');
export const vtiWriter = runAsyncVTKWriter('vti');
