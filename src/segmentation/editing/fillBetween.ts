import { defineStore } from 'pinia';
import vtkITKHelper from '@kitware/vtk.js/Common/DataModel/ITKHelper';
import { TypedArray } from '@kitware/vtk.js/types';
import { morphologicalContourInterpolation } from '@itk-wasm/morphological-contour-interpolation';
import type { Image } from 'itk-wasm';
import type { ProcessTarget } from '@/src/segmentation/editing/paintProcess';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import { fullExtent, reframeMaskScalars } from '@/src/segmentation/geometry';
import { SEGMENT_VALUE } from '@/src/segmentation/masks/labelValue';

type Interpolate = (
  image: Image,
  options: { label: number }
) => Promise<{ outputImage: Image }>;

export const useFillBetweenStore = defineStore('fillBetween', () => {
  async function computeAlgorithm(
    target: ProcessTarget,
    interpolate: Interpolate = morphologicalContourInterpolation
  ) {
    const extent = fullExtent(target.parentDimensions);
    const image = vtkImageData.newInstance({
      origin: target.parentOrigin,
      spacing: target.spacing,
      direction: target.direction,
    });
    image.setDimensions(target.parentDimensions);
    image.getPointData().setScalars(
      vtkDataArray.newInstance({
        numberOfComponents: 1,
        values: reframeMaskScalars(target.scalars, target.maskExtent, extent),
      })
    );
    // Interpolation's alignment and dilation depend on image boundaries, and
    // can leave the input contours' box. Only this transient input spans the
    // parent; the process commits the occupied result to bounded storage.
    const input = vtkITKHelper.convertVtkToItkImage(image);
    image.delete();
    const out = await interpolate(input, { label: SEGMENT_VALUE });
    return { scalars: out.outputImage.data as TypedArray, extent };
  }

  return {
    computeAlgorithm,
  };
});
