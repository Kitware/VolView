import { defineStore } from 'pinia';
import vtkITKHelper from '@kitware/vtk.js/Common/DataModel/ITKHelper';
import { TypedArray } from '@kitware/vtk.js/types';
import { morphologicalContourInterpolation } from '@itk-wasm/morphological-contour-interpolation';
import type { Image } from 'itk-wasm';
import type { ProcessTarget } from '@/src/store/tools/paintProcess';
import { useImageCacheStore } from '@/src/store/image-cache';
import { reframeMaskScalars } from '@/src/store/segmentMask';
import { fullExtent } from '@/src/types/segmentation';

type Interpolate = (
  image: Image,
  options: { label: number }
) => Promise<{ outputImage: Image }>;

export const useFillBetweenStore = defineStore('fillBetween', () => {
  async function computeAlgorithm(
    target: ProcessTarget,
    interpolate: Interpolate = morphologicalContourInterpolation
  ) {
    const parent = useImageCacheStore().getVtkImageData(target.parentImageId);
    if (!parent) throw new Error('No such parent image');
    const extent = fullExtent(target.parentDimensions);
    // Interpolation's alignment and dilation depend on image boundaries, and
    // can leave the input contours' box. Only this transient input spans the
    // parent; the process commits the occupied result to bounded storage.
    const input = {
      ...vtkITKHelper.convertVtkToItkImage(target.voxels.image()),
      origin: Array.from(parent.getOrigin()),
      size: [...target.parentDimensions],
      data: reframeMaskScalars(
        target.voxels.scalars(),
        target.maskExtent,
        extent
      ),
    };
    const out = await interpolate(input, { label: target.labelValue });
    return { scalars: out.outputImage.data as TypedArray, extent };
  }

  return {
    computeAlgorithm,
  };
});
