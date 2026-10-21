import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import { ThumbnailSlice } from '..';
import { createVTKImageThumbnailer } from '../vtk-image';

// Happy DOM has no canvas context or ImageData. Pixel generation only needs
// an RGBA buffer; canvas drawing and JPEG encoding are outside these cases.
class PixelBuffer {
  readonly data: Uint8ClampedArray;

  constructor(
    public width: number,
    public height: number
  ) {
    this.data = new Uint8ClampedArray(width * height * 4);
  }
}

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

describe('VTK Image Thumbnailer', () => {
  beforeEach(() => {
    vi.stubGlobal('ImageData', PixelBuffer);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      {} as CanvasRenderingContext2D
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

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
        try {
          const thumbnailer = createVTKImageThumbnailer();
          const point: [number, number, number] = [0, 1, 2];
          point[axis] = slice;
          scalars[i2o(...point)] = 255;

          const im = thumbnailer.generate(
            imageData,
            axis as 0 | 1 | 2,
            thumbSlice
          );
          const markerPixel = [7, 6, 3][axis];
          const expected = Array.from({ length: 9 }, (_, pixel) =>
            pixel === markerPixel ? [255, 255, 255, 255] : [0, 0, 0, 255]
          ).flat();
          expect([im.width, im.height]).toEqual([3, 3]);
          expect(Array.from(im.data)).toEqual(expected);
        } finally {
          imageData.getPointData().getScalars().delete();
          imageData.delete();
        }
      });
    }
  }
});
