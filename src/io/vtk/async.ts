import vtk from '@kitware/vtk.js/vtk';
import { URL } from 'whatwg-url';

import PromiseWorker from '@/src/utils/promise-worker';
import vtkDataSet from '@kitware/vtk.js/Common/DataModel/DataSet';
import { vtkObject } from '@kitware/vtk.js/interfaces';
import { StateObject } from './common';

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
  const worker = new PromiseWorker(
    new Worker(new URL('./async.reader.worker.ts', import.meta.url))
  );
  const data = (await worker.postMessage({
    file,
    readerName,
  })) as ReadResult;
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
    const worker = new PromiseWorker(
      new Worker(new URL('./async.writer.worker.ts', import.meta.url))
    );
    const result = (await worker.postMessage({
      obj: dataSet.getState(),
      writerName,
    })) as WriteResult;
    if (result.status === 'success') {
      return result.data;
    }
    throw result.error;
  };

export const stlReader = runAsyncVTKReader('stl');
export const vtiReader = runAsyncVTKReader('vti');
export const vtpReader = runAsyncVTKReader('vtp');
export const vtiWriter = runAsyncVTKWriter('vti');
