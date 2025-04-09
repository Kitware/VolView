import { describe, it } from 'vitest';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import { expect } from 'chai';
import { ThumbnailSlice } from '..';
import { createVTKImageThumbnailer } from '../vtk-image';

// workaround to get ImageData in the global scope
/*
global.ImageData = document
  .createElement('canvas')
  .getContext('2d')
  ?.createImageData(1, 1).constructor as any;
*/

// creates a 3x3x3 image
function createImageData() {
  const id = vtkImageData.newInstance();
  id.setDimensions([3, 3, 3]);
  const values = new Uint8Array(3 * 3 * 3);
  const da = vtkDataArray.newInstance({
    numberOfComponents: 1,
    values,
  });
  id.getPointData().setScalars(da);
  return { imageData: id, scalars: values };
}

// index to offset for a 3x3
function i2o(x: number, y: number, z: number) {
  return z * 9 + y * 3 + x;
}

describe.skip('VTK Image Thumbnailer', () => {
  const SLICE_POSITION_WORDS = ['first', 'middle', 'last'];
  const SLICE_POSITIONS = [
    ThumbnailSlice.First,
    ThumbnailSlice.Middle,
    ThumbnailSlice.Last,
  ];

  for (let axis = 0; axis < 3; axis++) {
    for (let slice = 0; slice < 3; slice++) {
      const sliceWord = SLICE_POSITION_WORDS[slice];
      const thumbSlice = SLICE_POSITIONS[slice];

      it(`should thumbnail the ${sliceWord} slice on axis ${axis}`, () => {
        const { imageData, scalars } = createImageData();
        const thumbnailer = createVTKImageThumbnailer();

        const point: [number, number, number] = [1, 1, 1];
        point[axis] = slice;
        scalars[i2o(...point)] = 255;

        const im = thumbnailer.generate(
          imageData,
          axis as 0 | 1 | 2,
          thumbSlice
        );
        // each pixel is rgba
        expect(im.data[4 * 4]).to.equal(255);
      });
    }
  }
});
