import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';

import { setActivePinia, createPinia } from 'pinia';

import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

chai.use(chaiAsPromised);

describe('View store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('supports setting all view configurations from image data', () => {
    const imageData = vtkImageData.newInstance();
    imageData.setOrigin([1, 2, 3]);
    imageData.setSpacing([4, 5, 6]);
    imageData.setDimensions([20, 21, 22]);
    imageData.setDirection([0, 1, 0, 0, 0, 1, 1, 0, 0]);
  });
});
