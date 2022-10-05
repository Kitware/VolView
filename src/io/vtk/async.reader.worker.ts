import vtkSTLReader from '@kitware/vtk.js/IO/Geometry/STLReader';
import vtkXMLImageDataReader from '@kitware/vtk.js/IO/XML/XMLImageDataReader';
import vtkXMLPolyDataReader from '@kitware/vtk.js/IO/XML/XMLPolyDataReader';

import workerHandler from '@/src/utils/workerHandler';
import { readFile } from './common';

const Readers = {
  stl: {
    readerClass: vtkSTLReader,
    asBinary: true,
  },
  vti: {
    readerClass: vtkXMLImageDataReader,
    asBinary: true,
  },
  vtp: {
    readerClass: vtkXMLPolyDataReader,
    asBinary: true,
  },
};

export interface ReaderWorkerInput {
  file: File;
  readerName: keyof typeof Readers;
}

workerHandler.registerHandler(async (data: ReaderWorkerInput) => {
  try {
    const { file, readerName } = data;
    if (!file) {
      throw new Error('No file provided');
    }
    if (!(readerName in Readers)) {
      throw new Error(`No reader found for ${file.name}`);
    }

    const { readerClass, asBinary } = Readers[readerName];
    const ds = await readFile(file, readerClass, asBinary);
    return {
      status: 'success',
      obj: ds.getState(),
    };
  } catch (error) {
    return {
      status: 'fail',
      error: error as Error,
    };
  }
});
