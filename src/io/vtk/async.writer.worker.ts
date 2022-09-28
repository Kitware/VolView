import vtkXMLImageDataWriter from '@kitware/vtk.js/IO/XML/XMLImageDataWriter';
import vtkDataSet from '@kitware/vtk.js/Common/DataModel/DataSet';

import workerHandler from '@/src/utils/workerHandler';
import vtkLabelMap from '@/src/vtk/LabelMap';
import vtk from '@kitware/vtk.js/vtk';

import { writeData, StateObject } from './common';

const Writers = {
  vti: {
    writerClass: vtkXMLImageDataWriter,
  },
};

export interface WorkerInput {
  obj: StateObject;
  writerName: keyof typeof Writers;
}

vtk.register('vtkLabelMap', vtkLabelMap.newInstance);

workerHandler.registerHandler(async (inputData: WorkerInput) => {
  try {
    const { obj, writerName } = inputData;
    if (!obj) {
      throw new Error('No data provided');
    }
    if (!(writerName in Writers)) {
      throw new Error(`No writer found for ${writerName}`);
    }

    const { writerClass } = Writers[writerName];

    const serialized = await writeData(writerClass, vtk(obj) as vtkDataSet);
    return {
      status: 'success',
      data: serialized,
    };
  } catch (error) {
    return {
      status: 'fail',
      error: error as Error,
    };
  }
});
