import type vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import type { PixelPaddingRange } from '@/src/core/streaming/dicom/pixelPadding';

type PaddingCrop = {
  values: ArrayLike<number>;
  validity: Uint8Array;
  extent: readonly number[];
  dimensions: readonly number[];
  width: number;
  height: number;
};

function markFrame(state: PaddingCrop, range: PixelPaddingRange, z: number) {
  const { values, validity, extent, dimensions, width, height } = state;
  const frameSize = dimensions[0] * dimensions[1];
  for (let y = extent[2]; y <= extent[3]; y++) {
    const sourceRow = extent[0] + y * dimensions[0] + z * frameSize;
    const targetRow =
      (y - extent[2]) * width + (z - extent[4]) * width * height;
    for (let x = 0; x < width; x++) {
      const value = values[sourceRow + x];
      if (value >= range.min && value <= range.max) validity[targetRow + x] = 0;
    }
  }
}

/** Source support in a selected mask crop; unmarked zero values remain valid. */
export function getSourceValidity(
  image: vtkImageData,
  padding: readonly PixelPaddingRange[],
  extent: readonly number[]
) {
  if (
    !padding.length ||
    extent.some((value, index) => index % 2 === 0 && value > extent[index + 1])
  )
    return undefined;
  const values = image.getPointData().getScalars().getData();
  const dimensions = image.getDimensions();
  const width = extent[1] - extent[0] + 1;
  const height = extent[3] - extent[2] + 1;
  const depth = extent[5] - extent[4] + 1;
  const validity = new Uint8Array(width * height * depth).fill(1);
  const state = { values, validity, extent, dimensions, width, height };
  for (const range of padding) {
    for (
      let z = Math.max(extent[4], range.firstFrame);
      z <= Math.min(extent[5], range.lastFrame);
      z++
    ) {
      markFrame(state, range, z);
    }
  }
  return { values: validity, extent: [...extent] };
}
