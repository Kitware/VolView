import vtkSTLReader from '@kitware/vtk.js/IO/Geometry/STLReader';

import workerHandler from '@/src/utils/workerHandler';
import readFile from './common';

// window shim
if (typeof window === 'undefined') {
  global.window = global;
}

const Readers = {
  stl: {
    readerClass: vtkSTLReader,
    asBinary: true,
  },
};

workerHandler.registerHandler(async (data) => {
  const { file, readerName } = data;
  if (!file) {
    throw new Error('No file provided');
  }
  if (!(readerName in Readers)) {
    throw new Error(`No reader found for ${file.name}`);
  }

  const { readerClass, asBinary } = Readers[readerName];
  const ds = await readFile(file, readerClass, asBinary);
  return ds.getState();
});
