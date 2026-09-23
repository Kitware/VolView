import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import type { TypedArray } from '@kitware/vtk.js/types';
import { ThumbnailSlice } from '.';

type ThumbnailPixels = {
  values: TypedArray;
  width: number;
  height: number;
  components: number;
  pixelIndex: (x: number, y: number) => number;
  scaleMin: number;
  scaleMax: number;
};

function colorChannelScale(values: TypedArray) {
  if (values instanceof Uint8Array || values instanceof Uint8ClampedArray) {
    return 1;
  }
  if (values instanceof Uint16Array) return 255 / 65535;
  return 255;
}

function imageSliceToImageData({
  values,
  width,
  height,
  components,
  pixelIndex,
  scaleMin,
  scaleMax,
}: ThumbnailPixels) {
  const im = new ImageData(width, height);
  const factor = 255 / (scaleMax - scaleMin);
  const byteFactor = colorChannelScale(values);
  const toByte = (value: number) => {
    if (components >= 3) return value * byteFactor;
    if (scaleMax === scaleMin) return 0;
    return (value - scaleMin) * factor;
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const source = pixelIndex(x, y) * components;
      const target = (y * width + x) * 4;
      const grayscale = components < 3;
      im.data[target] = toByte(values[source]);
      im.data[target + 1] = grayscale
        ? im.data[target]
        : toByte(values[source + 1]);
      im.data[target + 2] = grayscale
        ? im.data[target]
        : toByte(values[source + 2]);
      im.data[target + 3] =
        components === 2 || components === 4
          ? values[source + components - 1] * byteFactor
          : 255;
    }
  }

  return im;
}

/** Generates a thumbnail from one image plane. */
function generateThumbnail(
  imageData: vtkImageData,
  axis: 0 | 1 | 2 = 2,
  whichSlice = ThumbnailSlice.Middle
) {
  const scalars = imageData.getPointData().getScalars();
  const data = scalars.getData() as TypedArray;
  const components = scalars.getNumberOfComponents();
  const [scaleMin, scaleMax] = scalars.getRange(0);
  const dims = imageData.getDimensions();

  // ThumbnailSlice.First
  let slice = 0;
  if (whichSlice === ThumbnailSlice.Middle) {
    slice = Math.floor(dims[axis] / 2);
  } else if (whichSlice === ThumbnailSlice.Last) {
    slice = dims[axis] - 1;
  }

  let width: number;
  let height: number;
  let pixelIndex: (x: number, y: number) => number;

  if (axis === 0) {
    [, width, height] = dims;
    pixelIndex = (x, y) => slice + x * dims[0] + y * dims[0] * dims[1];
  } else if (axis === 1) {
    [width, , height] = dims;
    pixelIndex = (x, y) => x + slice * dims[0] + y * dims[0] * dims[1];
  } else {
    [width, height] = dims;
    pixelIndex = (x, y) => x + y * dims[0] + slice * dims[0] * dims[1];
  }

  return imageSliceToImageData({
    values: data,
    width,
    height,
    components,
    pixelIndex,
    scaleMin,
    scaleMax,
  });
}

export function createVTKImageThumbnailer() {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  const resizeCanvas = document.createElement('canvas');
  const resizeContext = resizeCanvas.getContext('2d');

  if (!ctx || !resizeContext) {
    throw new Error('[thumbnailer] Failed to create a 2D context');
  }
  return {
    generate(
      imageData: vtkImageData,
      axis: 0 | 1 | 2 = 2,
      whichSlice = ThumbnailSlice.Middle
    ) {
      return generateThumbnail(imageData, axis, whichSlice);
    },
    imageDataToDataURI(
      im: ImageData,
      resizeWidth: number,
      resizeHeight: number
    ) {
      canvas.width = im.width;
      canvas.height = im.height;
      ctx.putImageData(im, 0, 0);

      let { width, height } = im;
      if (im.width > im.height) {
        width = resizeWidth;
        height *= resizeWidth / im.width;
      } else {
        height = resizeHeight;
        width *= resizeHeight / im.height;
      }

      resizeCanvas.width = width;
      resizeCanvas.height = height;
      resizeContext.clearRect(0, 0, width, height);
      resizeContext.scale(width / im.width, height / im.height);
      resizeContext.drawImage(canvas, 0, 0);
      // jpegs are smaller than pngs
      return resizeCanvas.toDataURL('image/jpeg');
    },
  };
}
