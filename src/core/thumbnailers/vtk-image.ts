import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import { TypedArray } from '@kitware/vtk.js/types';
import { ThumbnailSlice } from '.';

function scalarImageToImageData(
  values: TypedArray,
  width: number,
  height: number,
  scaleMin: number,
  scaleMax: number
) {
  const im = new ImageData(width, height);
  const arr32 = new Uint32Array(im.data.buffer);
  // scale to 1 unsigned byte
  const factor = 255 / (scaleMax - scaleMin);
  for (let i = 0; i < values.length; i += 1) {
    const byte = Math.floor((values[i] - scaleMin) * factor);
    // ABGR order
    // eslint-disable-next-line no-bitwise
    arr32[i] = (255 << 24) | (byte << 16) | (byte << 8) | byte;
  }

  return im;
}

/**
 * Generates a thumbnail given an image data.
 *
 * Assumption: image is comprised of single-component scalars
 */
function generateThumbnail(
  imageData: vtkImageData,
  axis: 0 | 1 | 2 = 2,
  whichSlice = ThumbnailSlice.Middle
) {
  const scalars = imageData.getPointData().getScalars();
  const data = scalars.getData() as TypedArray;
  const dataRange = scalars.getRange();
  const dims = imageData.getDimensions();

  // ThumbnailSlice.First
  let slice = 0;
  if (whichSlice === ThumbnailSlice.Middle) {
    slice = Math.floor(dims[axis] / 2);
  } else if (whichSlice === ThumbnailSlice.Last) {
    slice = dims[axis] - 1;
  }

  let sliceData: TypedArray;
  let width: number;
  let height: number;

  if (axis === 0) {
    // work-around for typing data.constructor.
    // data is not necessarily of type Uint8Array.
    sliceData = new (<Uint8ArrayConstructor>data.constructor)(
      dims[1] * dims[2]
    );
    [, width, height] = dims;
    for (let k = 0; k < dims[2]; k++) {
      for (let j = 0; j < dims[1]; j++) {
        const index = slice + j * dims[0] + k * dims[0] * dims[1];
        const offset = k * dims[1] + j;
        sliceData[offset] = data[index];
      }
    }
  } else if (axis === 1) {
    sliceData = new (<Uint8ArrayConstructor>data.constructor)(
      dims[0] * dims[2]
    );
    [width, , height] = dims;
    for (let k = 0; k < dims[2]; k++) {
      for (let i = 0; i < dims[0]; i++) {
        const index = i + slice * dims[0] + k * dims[0] * dims[1];
        const offset = k * dims[0] + i;
        sliceData[offset] = data[index];
      }
    }
  } else if (axis === 2) {
    [width, height] = dims;
    const skip = dims[0] * dims[1];
    const sliceOffset = slice * skip;
    sliceData = Array.isArray(data)
      ? data.slice(sliceOffset, sliceOffset + skip)
      : data.subarray(sliceOffset, sliceOffset + skip);
  }

  return scalarImageToImageData(
    sliceData!,
    width!,
    height!,
    dataRange[0],
    dataRange[1]
  );
}

export function createVTKImageThumbnailer() {
  const canvas = document.createElement('canvas');
  return {
    generate(
      imageData: vtkImageData,
      axis: 0 | 1 | 2 = 2,
      whichSlice = ThumbnailSlice.Middle
    ) {
      return generateThumbnail(imageData, axis, whichSlice);
    },
    imageDataToDataURI(im: ImageData) {
      canvas.width = im.width;
      canvas.height = im.height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.putImageData(im, 0, 0);
        return canvas.toDataURL('image/png');
      }
      return '';
    },
  };
}
