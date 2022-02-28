import { expect } from 'chai';

import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

import { setActivePinia, createPinia } from 'pinia';
import { useDatasetStore } from '@src/storex/datasets';
import { makeDicomFile, makeEmptyFile } from '@/tests/testUtils';
import { FileIO } from '@src/io/io';
import { setCurrentInstance } from '@src/instances';
import { FileIOInst } from '@src/constants';

describe('Dataset store', () => {
  let fileIO: FileIO | null;
  beforeEach(() => {
    setActivePinia(createPinia());
    fileIO = setCurrentInstance<FileIO>(FileIOInst, new FileIO());
  });

  it('loads images', async () => {
    const datasetStore = useDatasetStore();
    const files = [
      makeEmptyFile('test1.nrrd'),
      makeEmptyFile('test2.nrrd'),
      makeEmptyFile('test3.nrrd'),
    ];

    const testImageData = vtkImageData.newInstance();
    fileIO!.addSingleReader('nrrd', () => testImageData);

    const loadResults = await datasetStore.loadFiles(files);
    expect(loadResults).to.deep.equal([
      { dataID: '1', filename: 'test1.nrrd', loaded: true },
      { dataID: '2', filename: 'test2.nrrd', loaded: true },
      { dataID: '3', filename: 'test3.nrrd', loaded: true },
    ]);
  });

  it('handles image errors', async () => {
    const datasetStore = useDatasetStore();
    const files = [makeEmptyFile('test1.nrrd'), makeEmptyFile('test2.nrrd')];
    const error = new Error('Failed to read NRRD');

    fileIO!.addSingleReader('nrrd', (file: File) => {
      if (file.name === 'test1.nrrd') {
        return vtkImageData.newInstance();
      }
      throw error;
    });

    const loadResults = await datasetStore.loadFiles(files);
    expect(loadResults).to.deep.equal([
      { dataID: '1', filename: 'test1.nrrd', loaded: true },
      { filename: 'test2.nrrd', loaded: false, error },
    ]);
  });

  it('handles loading DICOM', async () => {
    const datasetStore = useDatasetStore();
    const files = [
      makeDicomFile('dcm1'),
      makeDicomFile('dcm2'),
      makeDicomFile('dcm3'),
      makeDicomFile('dcm4'),
    ];

    const loadResults = await datasetStore.loadFiles(files);
    expect(loadResults).to.deep.equal([{ dicom: true, loaded: true }]);
  });
});
