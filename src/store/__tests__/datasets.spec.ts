import chai, { expect } from 'chai';
import chaiSubset from 'chai-subset';

import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

import { setActivePinia, createPinia } from 'pinia';
import { useDatasetStore } from '@src/store/datasets';
import { makeEmptyFile } from '@/tests/testUtils';
import { FILE_READERS } from '@/src/io';
import { CorePiniaProviderPlugin } from '@/src/core/provider';
import ProxyWrapper from '@/src/core/proxies';
import Sinon from 'sinon';

chai.use(chaiSubset);

describe('Dataset store', () => {
  let proxies = Sinon.createStubInstance(ProxyWrapper);

  beforeEach(() => {
    proxies = Sinon.createStubInstance(ProxyWrapper);

    const pinia = createPinia();
    pinia.use(
      CorePiniaProviderPlugin({
        proxies,
      })
    );

    setActivePinia(pinia);
  });

  it('loads images', async () => {
    const datasetStore = useDatasetStore();
    const files = [
      makeEmptyFile('test1.nrrd'),
      makeEmptyFile('test2.nrrd'),
      makeEmptyFile('test3.nrrd'),
    ];

    // override nrrd reader
    const testImageData = vtkImageData.newInstance();
    FILE_READERS.set('nrrd', () => testImageData);

    const loadResults = await datasetStore.loadFiles(files);
    expect(loadResults).to.containSubset([
      { type: 'file', filename: 'test1.nrrd', loaded: true, dataType: 'image' },
      { type: 'file', filename: 'test2.nrrd', loaded: true, dataType: 'image' },
      { type: 'file', filename: 'test3.nrrd', loaded: true, dataType: 'image' },
    ]);
  });

  it('handles missing readers', async () => {
    const datasetStore = useDatasetStore();
    const files = [makeEmptyFile('test1.invalid')];

    const loadResults = await datasetStore.loadFiles(files);
    expect(loadResults).to.containSubset([
      { type: 'file', filename: 'test1.invalid', loaded: false },
    ]);
  });

  it('handles readers that return an error', async () => {
    const datasetStore = useDatasetStore();
    const files = [makeEmptyFile('test1.invalid')];

    FILE_READERS.set('invalid', () => {
      throw new Error('invalid!');
    });

    const loadResults = await datasetStore.loadFiles(files);
    expect(loadResults).to.containSubset([
      { type: 'file', filename: 'test1.invalid', loaded: false },
    ]);
  });
});
