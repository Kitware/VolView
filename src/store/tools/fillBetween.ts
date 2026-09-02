import { defineStore } from 'pinia';
import vtkITKHelper from '@kitware/vtk.js/Common/DataModel/ITKHelper';
import { TypedArray } from '@kitware/vtk.js/types';
import { morphologicalContourInterpolation } from '@itk-wasm/morphological-contour-interpolation';
import type { ProcessTarget } from '@/src/store/tools/paintProcess';

export const useFillBetweenStore = defineStore('fillBetween', () => {
  async function computeAlgorithm(target: ProcessTarget): Promise<TypedArray> {
    // Interpolating between contours writes one label, so an image-scoped
    // target has nothing to interpolate.
    if (target.scope !== 'segment') {
      throw new Error(
        'Fill Between needs an active segment. Select one, then try again.'
      );
    }

    const vtkImage = vtkITKHelper.convertVtkToItkImage(target.voxels.image());
    const out = await morphologicalContourInterpolation(vtkImage, {
      label: target.labelValue,
    });

    const vtkOut = vtkITKHelper.convertItkToVtkImage(out.outputImage);
    const outputScalars = vtkOut.getPointData().getScalars();

    return outputScalars.getData() as TypedArray;
  }

  return {
    computeAlgorithm,
  };
});
